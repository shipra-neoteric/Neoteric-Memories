import fs from 'node:fs/promises'
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

export async function uploadPhotoBatch(
  eventId: string,
  files: UploadFileInput[],
  actor: { id: string; role: string }
): Promise<UploadOutcome> {
  const prisma = getPrisma()
  const event = await prisma.event.findUnique({ where: { id: eventId } })
  if (!event || event.deletedAt) throw new Error('Event not found')

  const outcome: UploadOutcome = { accepted: [], duplicates: [], rejected: [] }
  const acceptedFiles: { file: UploadFileInput; type: 'jpeg' | 'png'; hash: string }[] = []

  try {
    // Deliberately sequential (not Promise.all) and each file's buffer is read fresh
    // per-iteration, not held on to — this loop's peak memory is one file at a time,
    // not the whole batch, regardless of how many hundreds of files are in it.
    for (const file of files) {
      const buffer = await readInputBuffer(file)
      const type = sniffImageType(buffer)
      if (type === 'heic') {
        outcome.rejected.push({ filename: file.originalFilename, reason: 'HEIC is not supported in this environment yet — please convert to JPEG or PNG before uploading.' })
        await cleanupTempFile(file)
        continue
      }
      if (type === 'unknown') {
        outcome.rejected.push({ filename: file.originalFilename, reason: 'File is not a valid JPEG or PNG image (failed content validation).' })
        await cleanupTempFile(file)
        continue
      }
      const hash = hashFile(buffer)
      const existing = await prisma.photo.findUnique({ where: { eventId_fileHash: { eventId, fileHash: hash } } })
      if (existing) {
        outcome.duplicates.push({ filename: file.originalFilename })
        await cleanupTempFile(file)
        continue
      }
      acceptedFiles.push({ file, type, hash })
    }

    if (acceptedFiles.length === 0) return outcome

    const batch = await prisma.photoBatch.create({
      data: { eventId, uploadedById: actor.id, status: 'PROCESSING', totalCount: acceptedFiles.length },
    })

    const storage = getStorageProvider()
    for (const { file, type, hash } of acceptedFiles) {
      const buffer = await readInputBuffer(file)
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
      outcome.accepted.push({ photoId: photo.id, filename: file.originalFilename })
    }

    if (event.status === 'DRAFT') {
      await prisma.event.update({ where: { id: eventId }, data: { status: 'UPLOADING' } })
    }

    await writeAuditLog({
      actorId: actor.id,
      actorRole: actor.role,
      action: 'photo.batch_upload',
      entityType: 'PhotoBatch',
      entityId: batch.id,
      eventId,
      metadata: { accepted: outcome.accepted.length, duplicates: outcome.duplicates.length, rejected: outcome.rejected.length },
    })

    return outcome
  } finally {
    // Belt-and-suspenders: clean up any temp file that wasn't already removed above
    // (e.g. the function threw partway through processing an accepted file).
    await Promise.all(files.map((f) => cleanupTempFile(f)))
  }
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
