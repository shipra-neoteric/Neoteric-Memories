import { getPrisma } from '../../db.js'
import { getStorageProvider } from '../../providers/storage/index.js'
import { convertHeicToJpeg } from '../../lib/heicConvert.js'
import { storageKeys } from '../../lib/storageKeys.js'
import { logger } from '../../lib/logger.js'
import { enqueueJob } from '../queue.js'
import { finalizeBatchIfDone } from './photoProcess.js'

/**
 * Converts a photo uploaded as HEIC to JPEG, then hands off to the normal
 * PHOTO_PROCESS pipeline (face indexing + thumbnail/preview generation) exactly like
 * a photo that was never HEIC in the first place. Split out from photos/service.ts's
 * upload path as its own job (rather than converting inline before the Photo record
 * even exists) because the worker-thread HEIC decode (see lib/heicConvert.ts) is the
 * one genuinely slow, unpredictable step in the whole upload — running it inline in
 * the HTTP request risked exceeding the request timeout (see the "manual upload
 * timing out" incident), and running it as unawaited work after the response was
 * sent doesn't reliably finish on a serverless deployment (see api/index.js's own
 * doc comment) since the process can be frozen shortly after responding. Running it
 * as a proper queued job sidesteps both: the upload request only ever does the fast
 * synchronous part (dedupe + upload the original bytes as-is + create the Photo
 * row), and this job — picked up by whatever's actually polling the queue, a
 * persistent worker loop or a periodic /internal/cron hit — does the slow part on
 * its own schedule with no request waiting on it.
 */
export async function processHeicConvert(payload: { photoId: string; eventId?: string; batchId?: string }): Promise<void> {
  const prisma = getPrisma()
  const photo = await prisma.photo.findUnique({ where: { id: payload.photoId } })
  if (!photo || photo.deletedAt) return // Photo deleted before conversion ran — nothing to do (idempotent no-op).

  const event = await prisma.event.findUnique({ where: { id: photo.eventId } })
  if (!event || event.deletedAt) return

  const storage = getStorageProvider()
  const stagingKey = photo.originalKey

  try {
    const rawHeic = await storage.getObject(stagingKey)
    const converted = await convertHeicToJpeg(rawHeic)
    if (!converted) {
      throw new Error('This HEIC file could not be converted — it may be corrupted or in an unsupported HEIC variant.')
    }

    const finalKey = storageKeys.original(photo.eventId, photo.id, 'jpg')
    await storage.putObject({ key: finalKey, body: converted, contentType: 'image/jpeg' })
    // Best-effort cleanup of the staging object — a leftover .heic blob costs storage
    // but breaks nothing, so a failure here shouldn't fail the whole conversion.
    await storage.deleteObjects([stagingKey]).catch((err) => {
      logger.warn({ photoId: photo.id, stagingKey }, `Failed to clean up HEIC staging object: ${err instanceof Error ? err.message : String(err)}`)
    })

    await prisma.photo.update({
      where: { id: photo.id },
      data: { originalKey: finalKey, mimeType: 'image/jpeg', sizeBytes: converted.length, processingError: null },
    })

    await enqueueJob('PHOTO_PROCESS', { photoId: photo.id, eventId: photo.eventId, batchId: photo.batchId ?? undefined }, `photo-process:${photo.id}`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error({ photoId: photo.id, eventId: photo.eventId }, `HEIC conversion failed: ${message}`)
    await prisma.photo.update({ where: { id: photo.id }, data: { status: 'FAILED', processingError: message } })
    if (photo.batchId) {
      await prisma.photoBatch.update({ where: { id: photo.batchId }, data: { failedCount: { increment: 1 } } })
      await finalizeBatchIfDone(photo.batchId)
    }
    throw err
  }
}
