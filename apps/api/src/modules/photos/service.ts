import fs from 'node:fs/promises'
import crypto from 'node:crypto'
import { getPrisma } from '../../db.js'
import { getStorageProvider } from '../../providers/storage/index.js'
import { getFaceSearchProvider } from '../../providers/faceSearch/index.js'
import { enqueueJob } from '../../jobs/queue.js'
import { sniffImageType, extensionForType } from '../../lib/fileValidation.js'
import { hashFile } from '../../lib/hash.js'
import { storageKeys } from '../../lib/storageKeys.js'
import { logger } from '../../lib/logger.js'
import { writeAuditLog } from '../audit/service.js'

export interface UploadFileInput {
  originalFilename: string
  declaredMimeType: string
  // Exactly one of these is set. `buffer` for callers that already have the bytes in
  // memory in a bounded way (e.g. one Drive download at a time — see
  // modules/drive/service.ts). `filePath` for a local multipart upload's temp file on
  // disk. `storageKey` for a file the client already uploaded directly to storage via
  // a presigned URL (see presignUploads below + modules/photos/router.ts's
  // presign/finalize routes) — used instead of a request body containing the file's
  // bytes at all, since Vercel hard-rejects any request over ~4.5MB regardless of our
  // own code, which real phone photos routinely exceed.
  buffer?: Buffer
  filePath?: string
  storageKey?: string
  // Only meaningful alongside storageKey — the id presignUploads already baked into
  // that storage key (see storageKeys.original), so the Photo row created for it uses
  // the SAME id instead of a fresh auto-generated one, keeping the row and the object
  // that's already sitting in storage pointed at each other.
  photoId?: string
}

async function readInputBuffer(input: UploadFileInput): Promise<Buffer> {
  if (input.buffer) return input.buffer
  if (input.filePath) return fs.readFile(input.filePath)
  if (input.storageKey) return getStorageProvider().getObject(input.storageKey)
  throw new Error('UploadFileInput must have exactly one of buffer, filePath, or storageKey set')
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

/** Deletes an already-uploaded storage object for a file that turned out to be rejected/duplicate — a presigned upload always writes the object first (see presignUploads), so a file classify() doesn't accept would otherwise be orphaned in storage forever. */
async function cleanupOrphanedStorageObject(input: UploadFileInput): Promise<void> {
  if (!input.storageKey) return
  try {
    await getStorageProvider().deleteObject(input.storageKey)
  } catch (err) {
    logger.warn({ storageKey: input.storageKey }, `Failed to clean up orphaned storage object: ${err instanceof Error ? err.message : String(err)}`)
  }
}

/** A safe, lowercase extension guess from a filename — 'bin' if there isn't one worth trusting. Cosmetic only: the actual stored mimeType always comes from sniffing the real uploaded bytes (see classifyUploadBatch), never from this. */
function extensionFromFilename(filename: string): string {
  const match = /\.([a-zA-Z0-9]{1,8})$/.exec(filename)
  return match ? match[1].toLowerCase() : 'bin'
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
 * it against the event's existing photos for a duplicate. No HEIC decoding — just a
 * read + a hash per file, so this stays fast even for a few hundred files, and is
 * safe to run synchronously inside an HTTP request. Reads happen in small concurrent
 * chunks (UPLOAD_CONCURRENCY, defined below) rather than one at a time — for
 * storageKey-based files (the presigned-upload flow) each read is a network round
 * trip to storage, not a local disk read, so doing them sequentially would make this
 * scale badly with batch size the same way the old per-file-sequential storage
 * writes did (see processAcceptedFiles's own history).
 */
export async function classifyUploadBatch(eventId: string, files: UploadFileInput[]): Promise<ClassifyOutcome> {
  const prisma = getPrisma()
  const outcome: ClassifyOutcome = { accepted: [], duplicates: [], rejected: [] }

  const classifyOne = async (file: UploadFileInput): Promise<void> => {
    const buffer = await readInputBuffer(file)
    const type = sniffImageType(buffer)
    if (type === 'unknown') {
      outcome.rejected.push({ filename: file.originalFilename, reason: 'File is not a valid JPEG, PNG, or HEIC image (failed content validation).' })
      await cleanupTempFile(file)
      await cleanupOrphanedStorageObject(file)
      return
    }
    // Hashed on the original bytes (even for HEIC, ahead of any conversion) — a
    // stable identity for "is this the exact same source file", independent of
    // whatever a WASM decoder's output happens to be on a given run.
    const hash = hashFile(buffer)
    const existing = await prisma.photo.findUnique({ where: { eventId_fileHash: { eventId, fileHash: hash } } })
    if (existing) {
      outcome.duplicates.push({ filename: file.originalFilename })
      await cleanupTempFile(file)
      await cleanupOrphanedStorageObject(file)
      return
    }
    outcome.accepted.push({ file, type, hash })
  }

  for (let i = 0; i < files.length; i += UPLOAD_CONCURRENCY) {
    await Promise.all(files.slice(i, i + UPLOAD_CONCURRENCY).map((f) => classifyOne(f)))
  }

  return outcome
}

// Bounds how many files are read/hashed (classify) or uploaded+written (process)
// concurrently. Purely a wall-clock optimization — handling a batch one file at a
// time made total time scale linearly with batch count, and for a batch of real
// (not tiny synthetic-test-sized) photos that alone was enough to make even a modest
// 10-photo upload noticeably slow. Mirrors DRIVE_SYNC_CHUNK_SIZE in
// modules/drive/service.ts — same reasoning, same bound. Declared once, used by both
// classifyUploadBatch and processAcceptedFiles.
const UPLOAD_CONCURRENCY = 5

/**
 * Uploads every accepted file's bytes to storage and creates its Photo row. Stays
 * fast and safe to await directly inside an HTTP request even for a large batch:
 * HEIC files are NOT converted here — their original bytes are uploaded as-is and a
 * PHOTO_HEIC_CONVERT job (see jobs/processors/photoHeicConvert.ts) is queued to do
 * the actual worker-thread HEIC->JPEG decode later. That decode is the one genuinely
 * slow, unpredictable step in the whole upload (see the "manual upload timing out"
 * incident) — deferring it to the job queue instead of running it inline (like this
 * function used to) or firing it off unawaited after responding (which doesn't
 * reliably finish on a serverless deployment — see api/index.js) means this function
 * itself never risks exceeding a request timeout, on any deployment.
 */
export async function processAcceptedFiles(
  eventId: string,
  accepted: ClassifiedFile[],
  actor: { id: string; role: string }
): Promise<{ accepted: { photoId: string; filename: string }[]; failed: { filename: string; reason: string }[]; batchId: string | null }> {
  const result: { accepted: { photoId: string; filename: string }[]; failed: { filename: string; reason: string }[]; batchId: string | null } = {
    accepted: [],
    failed: [],
    batchId: null,
  }
  if (accepted.length === 0) return result

  const prisma = getPrisma()

  try {
    const event = await prisma.event.findUnique({ where: { id: eventId } })
    if (!event || event.deletedAt) throw new Error('Event not found')

    const batch = await prisma.photoBatch.create({
      data: { eventId, uploadedById: actor.id, status: 'PROCESSING', totalCount: accepted.length },
    })
    result.batchId = batch.id

    const storage = getStorageProvider()

    const uploadOne = async ({ file, type: sniffedType, hash }: ClassifiedFile): Promise<{ photoId: string; filename: string }> => {
      const buffer = await readInputBuffer(file)
      const isHeic = sniffedType === 'heic'
      const mimeType = isHeic ? 'image/heic' : sniffedType === 'png' ? 'image/png' : 'image/jpeg'
      // A presigned-upload file's bytes are already sitting in storage at exactly
      // this key (see presignUploads + UploadFileInput's own doc comment) — no need
      // to write them again, just point the Photo row at the id already baked into
      // that key.
      const alreadyUploaded = !!file.storageKey

      const photo = await prisma.photo.create({
        data: {
          ...(file.photoId ? { id: file.photoId } : {}),
          eventId,
          batchId: batch.id,
          originalKey: alreadyUploaded ? file.storageKey! : 'pending',
          fileHash: hash,
          originalFilename: file.originalFilename,
          mimeType,
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
      // HEIC is the default photo format on iPhone — reject it outright would mean
      // guests/admins can never use photos straight off an iPhone without manually
      // converting first. sharp can't decode it (its prebuilt binary only ships the
      // unlicensed AVIF/AV1 codec, not HEIC's licensed HEVC one), so it needs a real
      // decode via a pure-JS/WASM library — the one slow, unpredictable step in this
      // whole function, deferred to PHOTO_HEIC_CONVERT (see this function's own doc
      // comment) instead of done here. The original bytes are uploaded as-is in the
      // meantime so nothing is lost if that job is delayed.
      if (!alreadyUploaded) {
        const key = storageKeys.original(eventId, photo.id, isHeic ? 'heic' : extensionForType(sniffedType))
        await storage.putObject({ key, body: buffer, contentType: mimeType })
        await prisma.photo.update({ where: { id: photo.id }, data: { originalKey: key } })
      }
      await cleanupTempFile(file)

      // eventId/batchId are carried in the payload (not just derivable by looking the
      // photo back up) so an admin-scoped claim — see jobs/loop.ts's
      // claimAndRunScopedJob, used by POST /api/admin/jobs/process-next — can filter
      // to "jobs for this upload batch" without an extra DB round trip per candidate.
      if (isHeic) {
        await enqueueJob('PHOTO_HEIC_CONVERT', { photoId: photo.id, eventId, batchId: batch.id }, `heic-convert:${photo.id}`)
      } else {
        await enqueueJob('PHOTO_PROCESS', { photoId: photo.id, eventId, batchId: batch.id }, `photo-process:${photo.id}`)
      }
      return { photoId: photo.id, filename: file.originalFilename }
    }

    for (let i = 0; i < accepted.length; i += UPLOAD_CONCURRENCY) {
      const chunk = accepted.slice(i, i + UPLOAD_CONCURRENCY)
      const uploaded = await Promise.all(chunk.map((c) => uploadOne(c)))
      result.accepted.push(...uploaded)
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

// Long enough to comfortably cover picking files, a slow connection, and a batch of
// several uploads happening one after another — but still a bounded window, since an
// expired URL just means the client asks for a fresh one, not a security concern.
const UPLOAD_URL_TTL_SECONDS = 15 * 60

export interface PresignedUpload {
  filename: string
  photoId: string
  key: string
  uploadUrl: string
  headers: Record<string, string>
}

/**
 * Issues one presigned direct-to-storage upload URL per requested file, so the
 * browser can PUT each file's bytes straight to storage instead of through this API
 * — see UploadFileInput's own doc comment for why manual upload needs this at all
 * (Vercel's hard ~4.5MB request body limit, which real phone photos routinely
 * exceed). Each file gets its own pre-generated Photo id baked into its storage key
 * up front, so `POST .../photos/finalize` (see modules/photos/router.ts) can create
 * that exact row without a separate rename/copy step once the upload completes.
 */
export async function presignUploads(
  eventId: string,
  files: { filename: string; contentType: string }[]
): Promise<PresignedUpload[]> {
  const storage = getStorageProvider()
  return Promise.all(
    files.map(async (f) => {
      const photoId = crypto.randomBytes(12).toString('hex')
      const key = storageKeys.original(eventId, photoId, extensionFromFilename(f.filename))
      const { url, headers } = await storage.getSignedUploadUrl(key, UPLOAD_URL_TTL_SECONDS, f.contentType || 'application/octet-stream')
      return { filename: f.filename, photoId, key, uploadUrl: url, headers }
    })
  )
}

export async function retryPhotoProcessing(photoId: string, actor: { id: string; role: string }): Promise<void> {
  const prisma = getPrisma()
  const photo = await prisma.photo.findUnique({ where: { id: photoId } })
  if (!photo || photo.deletedAt) throw new Error('Photo not found')
  await prisma.photo.update({ where: { id: photoId }, data: { status: 'PENDING', processingError: null } })
  await enqueueJob(
    'PHOTO_PROCESS',
    { photoId, eventId: photo.eventId, batchId: photo.batchId ?? undefined },
    `photo-process:${photoId}:retry:${Date.now()}`
  )
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
