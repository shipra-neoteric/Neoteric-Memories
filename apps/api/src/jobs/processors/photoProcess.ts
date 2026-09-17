import sharp from 'sharp'
import { getPrisma } from '../../db.js'
import { getStorageProvider } from '../../providers/storage/index.js'
import { getFaceSearchProvider } from '../../providers/faceSearch/index.js'
import { storageKeys } from '../../lib/storageKeys.js'
import { logger } from '../../lib/logger.js'
import { normalizeForFaceProvider } from '../../lib/imageResize.js'
import { toJsonInput } from '../../lib/prismaJson.js'
import { writeAuditLog } from '../../modules/audit/service.js'

const LOW_QUALITY_CONFIDENCE_THRESHOLD = 65

export async function processPhotoProcess(payload: { photoId: string }): Promise<void> {
  const prisma = getPrisma()
  const photo = await prisma.photo.findUnique({ where: { id: payload.photoId } })
  if (!photo || photo.deletedAt) return // Photo deleted after indexing was requested — nothing to do (idempotent no-op).

  const event = await prisma.event.findUnique({ where: { id: photo.eventId } })
  if (!event || event.deletedAt) return

  await prisma.photo.update({ where: { id: photo.id }, data: { status: 'PROCESSING' } })

  const storage = getStorageProvider()
  const faceProvider = getFaceSearchProvider()

  try {
    const original = await storage.getObject(photo.originalKey)

    // Cloud face providers (Rekognition) cap inline image bytes at 5MB — a real
    // event photo routinely exceeds that. Only the copy sent for face detection is
    // downscaled; the stored original/thumbnail/preview are unaffected.
    const forFaceDetection = await normalizeForFaceProvider(original)
    const faces = await faceProvider.indexPhotoFaces({ eventId: photo.eventId, photoId: photo.id, imageBuffer: forFaceDetection })

    // Existing IndexedFace rows are our own domain-side mirror of what the provider
    // indexed — clear + re-insert makes reprocessing (a retried job) idempotent.
    await prisma.indexedFace.deleteMany({ where: { photoId: photo.id } })
    if (faces.length > 0) {
      await prisma.indexedFace.createMany({
        data: faces.map((f) => ({
          photoId: photo.id,
          eventId: photo.eventId,
          providerFaceId: f.providerFaceId,
          boundingBox: toJsonInput(f.boundingBox),
          confidence: f.confidence,
        })),
      })
    }

    const avgConfidence = faces.length > 0 ? faces.reduce((s, f) => s + f.confidence, 0) / faces.length : 0
    const hasQualityWarning = faces.length > 0 && avgConfidence < LOW_QUALITY_CONFIDENCE_THRESHOLD

    const thumbnail = await sharp(original).rotate().resize({ width: 400, withoutEnlargement: true }).jpeg({ quality: 78 }).toBuffer()
    const preview = await sharp(original).rotate().resize({ width: 1600, withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer()

    await storage.putObject({ key: storageKeys.thumbnail(photo.eventId, photo.id), body: thumbnail, contentType: 'image/jpeg' })
    await storage.putObject({ key: storageKeys.preview(photo.eventId, photo.id), body: preview, contentType: 'image/jpeg' })

    await prisma.photo.update({
      where: { id: photo.id },
      data: {
        status: faces.length > 0 ? 'PROCESSED' : 'NO_FACES',
        faceCount: faces.length,
        hasQualityWarning,
        thumbnailKey: storageKeys.thumbnail(photo.eventId, photo.id),
        previewKey: storageKeys.preview(photo.eventId, photo.id),
        processingError: null,
      },
    })

    if (photo.batchId) {
      await prisma.photoBatch.update({
        where: { id: photo.batchId },
        data: { processedCount: { increment: 1 } },
      })
      await finalizeBatchIfDone(photo.batchId)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error({ photoId: photo.id, eventId: photo.eventId }, `Photo processing failed: ${message}`)
    await prisma.photo.update({ where: { id: photo.id }, data: { status: 'FAILED', processingError: message } })
    if (photo.batchId) {
      await prisma.photoBatch.update({ where: { id: photo.batchId }, data: { failedCount: { increment: 1 } } })
      await finalizeBatchIfDone(photo.batchId)
    }
    await writeAuditLog({
      action: 'photo.process_failed',
      entityType: 'Photo',
      entityId: photo.id,
      eventId: photo.eventId,
      metadata: { message },
    })
    throw err
  }
}

export async function finalizeBatchIfDone(batchId: string): Promise<void> {
  const prisma = getPrisma()
  const batch = await prisma.photoBatch.findUnique({ where: { id: batchId } })
  if (!batch) return
  const done = batch.processedCount + batch.failedCount
  if (done < batch.totalCount) return
  await prisma.photoBatch.update({
    where: { id: batchId },
    data: { status: batch.failedCount > 0 ? 'PARTIAL_FAILURE' : 'COMPLETED', completedAt: new Date() },
  })
}
