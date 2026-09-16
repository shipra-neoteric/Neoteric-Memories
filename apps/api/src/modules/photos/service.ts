import fs from 'node:fs/promises'
import { getPrisma } from '../../db.js'
import { getStorageProvider } from '../../providers/storage/index.js'
import { getFaceSearchProvider } from '../../providers/faceSearch/index.js'
import { enqueueJob } from '../../jobs/queue.js'
import { sniffImageType, extensionForType } from '../../lib/fileValidation.js'
import { convertHeicToJpeg } from '../../lib/heicConvert.js'
import { hashFile } from '../../lib/hash.js'
import { storageKeys } from '../../lib/storageKeys.js'
import { logger } from '../../lib/logger.js'
import { writeAuditLog } from '../audit/service.js'

export interface UploadFileInput {
  originalFilename: string
  declaredMimeType: string
  // Exactly one of these is set. `buffer` for callers that already have the bytes in
  // memory in a bounded way (e.g. one Drive download at a time — see
  // modules/drive/service.ts). `filePath` for the HTTP multipart upload route, whose
  // multer config streams straight to a temp file on disk instead of buffering every
  // file in a large batch in RAM simultaneously (which is what let a big-enough batch
  // exhaust the process's memory and get killed partway through, silently leaving
  // only however many files had already been written to the DB by that point).
  buffer?: Buffer
  filePath?: string
}

async function readInputBuffer(input: UploadFileInput): Promise<Buffer> {
  if (input.buffer) return input.buffer
  if (input.filePath) return fs.readFile(input.filePath)
  throw new Error('UploadFileInput must have either buffer or filePath set')
}

async function cleanupTempFile(input: UploadFileInput): Promise<void> {
  if (!input.filePath) return
  try {
    await fs.unlink(input.filePath)
  } catch (err) {
    // ENOENT just means some earlier call in the same batch already removed it
    // (this is deliberately called again as a belt-and-suspenders sweep in a
    // `finally`) — not worth logging.
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return
    logger.warn({ filePath: input.filePath }, `Failed to remove temp upload file: ${err instanceof Error ? err.message : String(err)}`)
  }
}

export interface UploadOutcome {
  accepted: { photoId: string; filename: string }[]
  duplicates: { filename: string }[]
  rejected: { filename: string; reason: string }[]
}

export interface ClassifiedFile {
  file: UploadFileInput
  type: 'jpeg' | 'png' | 'heic'
  hash: string
}

export interface ClassifyOutcome {
  accepted: ClassifiedFile[]
  duplicates: { filename: string }[]
  rejected: { filename: string; reason: string }[]
}

/**
 * The cheap half of an upload: sniff each file's real type from its bytes and check
 * it against the event's existing photos for a duplicate. No HEIC decoding, no S3
 * writes — just a disk read + a hash per file, so this stays fast (a few seconds at
 * most) even for a few hundred files, and is safe to run synchronously inside an
 * HTTP request. The expensive part (HEIC conversion, storage upload) is
 * `processAcceptedFiles`, deliberately kept separate so callers with a request
 * timeout to respect (the manual upload route) can respond as soon as this
 * classification is done and hand the accepted files off to run in the background.
 */
export async function classifyUploadBatch(eventId: string, files: UploadFileInput[]): Promise<ClassifyOutcome> {
  const prisma = getPrisma()
  const outcome: ClassifyOutcome = { accepted: [], duplicates: [], rejected: [] }

  // Deliberately sequential (not Promise.all) and each file's buffer is read fresh
  // per-iteration, not held on to — this loop's peak memory is one file at a time,
  // not the whole batch, regardless of how many hundreds of files are in it.
  for (const file of files) {
    const buffer = await readInputBuffer(file)
    const type = sniffImageType(buffer)
    if (type === 'unknown') {
      outcome.rejected.push({ filename: file.originalFilename, reason: 'File is not a valid JPEG, PNG, or HEIC image (failed content validation).' })
      await cleanupTempFile(file)
      continue
    }
    // Hashed on the original bytes (even for HEIC, ahead of any conversion) — a
    // stable identity for "is this the exact same source file", independent of
    // whatever a WASM decoder's output happens to be on a given run.
    const hash = hashFile(buffer)
    const existing = await prisma.photo.findUnique({ where: { eventId_fileHash: { eventId, fileHash: hash } } })
    if (existing) {
      outcome.duplicates.push({ filename: file.originalFilename })
      await cleanupTempFile(file)
      continue
    }
    outcome.accepted.push({ file, type, hash })
  }

  return outcome
}

/**
 * The slow half of an upload: HEIC->JPEG conversion (a worker-thread round-trip per
 * file, see lib/heicConvert.ts) and the storage upload itself. For a batch with
 * several HEIC files this can easily run past any reasonable HTTP timeout, so the
 * manual upload route fires this off in the background instead of awaiting it — the
 * already-existing periodic photos-list refetch on the event page is what surfaces
 * the results as they land.
 */
export async function processAcceptedFiles(
  eventId: string,
  accepted: ClassifiedFile[],
  actor: { id: string; role: string }
): Promise<{ accepted: { photoId: string; filename: string }[]; failed: { filename: string; reason: string }[] }> {
  const result: { accepted: { photoId: string; filename: string }[]; failed: { filename: string; reason: string }[] } = {
    accepted: [],
    failed: [],
  }
  if (accepted.length === 0) return result

  const prisma = getPrisma()

  try {
    const event = await prisma.event.findUnique({ where: { id: eventId } })
    if (!event || event.deletedAt) throw new Error('Event not found')

    const batch = await prisma.photoBatch.create({
      data: { eventId, uploadedById: actor.id, status: 'PROCESSING', totalCount: accepted.length },
    })

    const storage = getStorageProvider()
    for (const { file, type: sniffedType, hash } of accepted) {
      let buffer = await readInputBuffer(file)
      let type: 'jpeg' | 'png' = sniffedType === 'png' ? 'png' : 'jpeg'

      if (sniffedType === 'heic') {
        // HEIC is the default photo format on iPhone — reject it outright would mean
        // guests/admins can never use photos straight off an iPhone without manually
        // converting first. sharp can't decode it (its prebuilt binary only ships the
        // unlicensed AVIF/AV1 codec, not HEIC's licensed HEVC one), so convert it to a
        // real JPEG up front via a pure-JS/WASM decoder instead, then treat it exactly
        // like any other JPEG for the rest of the pipeline.
        const converted = await convertHeicToJpeg(buffer)
        if (!converted) {
          result.failed.push({ filename: file.originalFilename, reason: 'This HEIC file could not be converted — it may be corrupted or in an unsupported HEIC variant.' })
          await cleanupTempFile(file)
          continue
        }
        buffer = converted
        type = 'jpeg'
      }

      const photo = await prisma.photo.create({
        data: {
          eventId,
          batchId: batch.id,
          originalKey: 'pending',
          fileHash: hash,
          originalFilename: file.originalFilename,
          mimeType: type === 'png' ? 'image/png' : 'image/jpeg',
          sizeBytes: buffer.length,
          status: 'PENDING',
          uploadedById: actor.id,
          // Explicitly written — Prisma's MongoDB connector's `{ deletedAt: null }`
          // filter (used throughout to mean "not soft-deleted") only matches documents
          // where the field is actually present and null, not documents where it was
          // simply never set. Without this, every "exclude deleted photos" query would
          // silently exclude every photo that had never been deleted — exactly the bug
          // this fixes.
          deletedAt: null,
        },
      })
      const key = storageKeys.original(eventId, photo.id, extensionForType(type))
      await storage.putObject({ key, body: buffer, contentType: type === 'png' ? 'image/png' : 'image/jpeg' })
      await prisma.photo.update({ where: { id: photo.id }, data: { originalKey: key } })
      await cleanupTempFile(file)

      await enqueueJob('PHOTO_PROCESS', { photoId: photo.id }, `photo-process:${photo.id}`)
      result.accepted.push({ photoId: photo.id, filename: file.originalFilename })
    }

    if (event.status === 'DRAFT' && result.accepted.length > 0) {
      await prisma.event.update({ where: { id: eventId }, data: { status: 'UPLOADING' } })
    }

    await prisma.photoBatch.update({
      where: { id: batch.id },
      data: { status: 'COMPLETED', processedCount: result.accepted.length, failedCount: result.failed.length, completedAt: new Date() },
    })

    await writeAuditLog({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'photo.batch_upload',
      entityType: 'PhotoBatch',
      entityId: batch.id,
      eventId,
      metadata: { accepted: result.accepted.length, failed: result.failed.length },
    })

    return result
  } finally {
    // Belt-and-suspenders: clean up any temp file that wasn't already removed above
    // (e.g. the function threw partway through processing an accepted file).
    await Promise.all(accepted.map((a) => cleanupTempFile(a.file)))
  }
}

/**
 * Convenience wrapper composing classify + process synchronously, for callers that
 * are already running in a background context of their own and want one immediate
 * result (Drive sync, dev-seed data) — not used by the HTTP upload route, which
 * needs the two halves split so it can respond before the slow half finishes.
 */
export async function uploadPhotoBatch(
  eventId: string,
  files: UploadFileInput[],
  actor: { id: string; role: string }
): Promise<UploadOutcome> {
  const classified = await classifyUploadBatch(eventId, files)
  const { accepted, failed } = await processAcceptedFiles(eventId, classified.accepted, actor)
  return { accepted, duplicates: classified.duplicates, rejected: [...classified.rejected, ...failed] }
}

export async function retryPhotoProcessing(photoId: string, actor: { id: string; role: string }): Promise<void> {
  const prisma = getPrisma()
  const photo = await prisma.photo.findUnique({ where: { id: photoId } })
  if (!photo || photo.deletedAt) throw new Error('Photo not found')
  await prisma.photo.update({ where: { id: photoId }, data: { status: 'PENDING', processingError: null } })
  await enqueueJob('PHOTO_PROCESS', { photoId }, `photo-process:${photoId}:retry:${Date.now()}`)
  await writeAuditLog({ actorId: actor.id, actorRole: actor.role, action: 'photo.retry', entityType: 'Photo', entityId: photoId, eventId: photo.eventId })
}

export async function archivePhoto(photoId: string, archived: boolean, actor: { id: string; role: string }): Promise<void> {
  const prisma = getPrisma()
  const photo = await prisma.photo.update({ where: { id: photoId }, data: { isArchived: archived } })
  await writeAuditLog({
    actorId: actor.id,
    actorRole: actor.role,
    action: archived ? 'photo.archive' : 'photo.unarchive',
    entityType: 'Photo',
    entityId: photoId,
    eventId: photo.eventId,
  })
}

/** Hard delete: removes the biometric index for this photo from the provider too, not just the DB row — required so a deleted photo can never surface in a future search. */
export async function deletePhoto(photoId: string, actor: { id: string; role: string }): Promise<void> {
  const prisma = getPrisma()
  const photo = await prisma.photo.findUnique({ where: { id: photoId } })
  if (!photo) return

  const indexedFaces = await prisma.indexedFace.findMany({ where: { photoId } })
  if (indexedFaces.length > 0) {
    await getFaceSearchProvider().removePhotoFaces({
      eventId: photo.eventId,
      photoId,
      providerFaceIds: indexedFaces.map((f) => f.providerFaceId),
    })
    await prisma.indexedFace.deleteMany({ where: { photoId } })
  }

  const storage = getStorageProvider()
  const keys = [photo.originalKey, photo.thumbnailKey, photo.previewKey].filter((k): k is string => !!k)
  if (keys.length > 0) await storage.deleteObjects(keys)

  await prisma.photo.update({ where: { id: photoId }, data: { status: 'DELETED', deletedAt: new Date() } })
  await writeAuditLog({ actorId: actor.id, actorRole: actor.role, action: 'photo.delete', entityType: 'Photo', entityId: photoId, eventId: photo.eventId })
}
