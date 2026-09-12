import { DEFAULTS } from '@neoteric-memories/shared'
import { getPrisma } from '../../db.js'
import { Errors } from '../../lib/errors.js'
import { getStorageProvider } from '../../providers/storage/index.js'
import { getFaceSearchProvider } from '../../providers/faceSearch/index.js'
import { getLivenessProvider } from '../../providers/liveness/index.js'
import { sniffImageType } from '../../lib/fileValidation.js'
import { hashSelfieBuffer } from '../../lib/hash.js'
import { normalizeForFaceProvider } from '../../lib/imageResize.js'
import { storageKeys } from '../../lib/storageKeys.js'
import { enqueueJob } from '../../jobs/queue.js'
import { logger } from '../../lib/logger.js'
import { writeSecurityEvent } from '../audit/service.js'

export type SelfieRejectionReason =
  | 'INVALID_IMAGE'
  | 'NO_FACE_DETECTED'
  | 'MULTIPLE_FACES_DETECTED'
  | 'FACE_TOO_SMALL'
  | 'PROCESSING_FAILED'

export class SelfieRejectedError extends Error {
  reason: SelfieRejectionReason
  constructor(reason: SelfieRejectionReason, message: string) {
    super(message)
    this.reason = reason
  }
}

const MIN_FACE_AREA_FRACTION = 0.015 // face bounding box must cover at least ~1.5% of the frame

export interface SelfieSearchResult {
  faceSearchId: string
  resultCount: number
}

/**
 * The full selfie -> search pipeline for one guest attempt. Every step is scoped to
 * a single eventId end-to-end, which is what makes cross-event search structurally
 * impossible (see FaceSearchProvider.ts's doc comment).
 */
export async function performSelfieSearch(
  sessionId: string,
  eventId: string,
  rawSelfieBuffer: Buffer
): Promise<SelfieSearchResult> {
  const prisma = getPrisma()
  const imageType = sniffImageType(rawSelfieBuffer)
  if (imageType === 'unknown' || imageType === 'heic') {
    throw new SelfieRejectedError('INVALID_IMAGE', 'That does not look like a valid photo. Please try capturing your selfie again.')
  }

  // Cloud face providers (Rekognition) cap inline image bytes at 5MB — a real phone
  // photo routinely exceeds that. Normalize once, up front, and use this buffer for
  // every downstream step (detection, storage, search) — bounding boxes returned by
  // the provider are fractional, so this never affects accuracy.
  const selfieBuffer = await normalizeForFaceProvider(rawSelfieBuffer)

  const livenessResult = await getLivenessProvider().checkLiveness(selfieBuffer)
  // L1 mock liveness always passes; a real provider's `isLive: false` would be handled the same way a rejected capture is handled below, once implemented.
  void livenessResult

  const faceProvider = getFaceSearchProvider()
  let detected
  try {
    detected = await faceProvider.detectFaces(selfieBuffer)
  } catch (err) {
    logger.error({ eventId, guestSessionId: sessionId }, `Face detection failed: ${err instanceof Error ? err.message : String(err)}`)
    throw new SelfieRejectedError('PROCESSING_FAILED', 'Something went wrong while processing your selfie. Please try again.')
  }

  if (detected.length === 0) {
    await writeSecurityEvent({ type: 'NO_FACE_IN_SELFIE', eventId, guestSessionId: sessionId })
    throw new SelfieRejectedError('NO_FACE_DETECTED', 'We could not detect a face in that photo. Make sure your face is clearly visible and well lit, then try again.')
  }
  if (detected.length > 1) {
    await writeSecurityEvent({ type: 'MULTIPLE_FACES_IN_SELFIE', eventId, guestSessionId: sessionId })
    throw new SelfieRejectedError('MULTIPLE_FACES_DETECTED', 'We detected more than one face. Please make sure only you are in the frame, then try again.')
  }

  const [face] = detected
  const area = face.boundingBox.width * face.boundingBox.height
  if (area < MIN_FACE_AREA_FRACTION) {
    throw new SelfieRejectedError('FACE_TOO_SMALL', 'Your face is too small in the frame. Please move closer and try again.')
  }

  const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } })
  const threshold = event.matchThreshold ?? DEFAULTS.HIGH_CONFIDENCE_THRESHOLD

  const search = await prisma.faceSearch.create({
    // selfieDeletedAt is explicitly null (not simply omitted) — the retention sweep's
    // "find selfies not yet deleted" query filters on `selfieDeletedAt: null`, which
    // (per Prisma's MongoDB connector) only matches documents where the field is
    // actually present and null, not documents where it was never set.
    data: { eventId, guestSessionId: sessionId, status: 'PROCESSING', selfieHash: hashSelfieBuffer(selfieBuffer), selfieDeletedAt: null },
  })

  const storage = getStorageProvider()
  const selfieKey = storageKeys.selfie(eventId, search.id)
  await storage.putObject({ key: selfieKey, body: selfieBuffer, contentType: 'image/jpeg' })

  try {
    const rawMatches = await faceProvider.searchEventBySelfie({
      eventId,
      selfieBuffer,
      maxResults: DEFAULTS.MAX_RESULTS_PER_SEARCH,
      minSimilarity: threshold,
    })

    // Defense in depth: even though the provider only searched this event's own
    // collection, re-verify every matched photo still belongs to this event and is
    // in a guest-visible state (not deleted/archived/still processing).
    const photoIds = rawMatches.map((m) => m.photoId)
    const validPhotos = await prisma.photo.findMany({
      where: { id: { in: photoIds }, eventId, deletedAt: null, isArchived: false, status: 'PROCESSED' },
      select: { id: true },
    })
    const validPhotoIds = new Set(validPhotos.map((p) => p.id))
    const matches = rawMatches.filter((m) => validPhotoIds.has(m.photoId))

    if (matches.length > 0) {
      await prisma.faceMatch.createMany({
        data: matches.map((m) => ({
          faceSearchId: search.id,
          photoId: m.photoId,
          providerFaceId: m.providerFaceId,
          similarity: m.similarity,
          confidenceBand: 'HIGH',
        })),
      })
    }

    await prisma.faceSearch.update({
      where: { id: search.id },
      data: { status: 'COMPLETED', resultCount: matches.length, completedAt: new Date() },
    })
    await prisma.guestSession.update({ where: { id: sessionId }, data: { searchCount: { increment: 1 } } })

    await enqueueJob('SELFIE_DELETE', { faceSearchId: search.id }, `selfie-delete:${search.id}`)

    return { faceSearchId: search.id, resultCount: matches.length }
  } catch (err) {
    await prisma.faceSearch.update({
      where: { id: search.id },
      data: { status: 'FAILED', errorMessage: err instanceof Error ? err.message : String(err) },
    })
    await enqueueJob('SELFIE_DELETE', { faceSearchId: search.id }, `selfie-delete:${search.id}`)
    throw Errors.badRequest('Search failed due to a temporary issue. Please try again.')
  }
}
