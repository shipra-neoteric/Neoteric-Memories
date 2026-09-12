import { getPrisma } from '../../db.js'
import { getStorageProvider } from '../../providers/storage/index.js'
import { getFaceSearchProvider } from '../../providers/faceSearch/index.js'
import { enqueueJob } from '../../jobs/queue.js'
import { sniffImageType, extensionForType } from '../../lib/fileValidation.js'
import { hashFile } from '../../lib/hash.js'
import { storageKeys } from '../../lib/storageKeys.js'
import { writeAuditLog } from '../audit/service.js'

export interface UploadFileInput {
  buffer: Buffer
  originalFilename: string
  declaredMimeType: string
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

  for (const file of files) {
    const type = sniffImageType(file.buffer)
    if (type === 'heic') {
      outcome.rejected.push({ filename: file.originalFilename, reason: 'HEIC is not supported in this environment yet — please convert to JPEG or PNG before uploading.' })
      continue
    }
    if (type === 'unknown') {
      outcome.rejected.push({ filename: file.originalFilename, reason: 'File is not a valid JPEG or PNG image (failed content validation).' })
      continue
    }
    const hash = hashFile(file.buffer)
    const existing = await prisma.photo.findUnique({ where: { eventId_fileHash: { eventId, fileHash: hash } } })
    if (existing) {
      outcome.duplicates.push({ filename: file.originalFilename })
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
    const photo = await prisma.photo.create({
      data: {
        eventId,
        batchId: batch.id,
        originalKey: 'pending',
        fileHash: hash,
        originalFilename: file.originalFilename,
        mimeType: type === 'png' ? 'image/png' : 'image/jpeg',
        sizeBytes: file.buffer.length,
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
    await storage.putObject({ key, body: file.buffer, contentType: type === 'png' ? 'image/png' : 'image/jpeg' })
    await prisma.photo.update({ where: { id: photo.id }, data: { originalKey: key } })

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
