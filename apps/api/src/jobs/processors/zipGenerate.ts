import archiver from 'archiver'
import { getPrisma } from '../../db.js'
import { getStorageProvider } from '../../providers/storage/index.js'
import { storageKeys } from '../../lib/storageKeys.js'
import { logger } from '../../lib/logger.js'

/**
 * Buffers the whole ZIP in memory before upload — acceptable for L1's expected scale
 * (a guest's own matched-photo set, capped at DEFAULTS.MAX_RESULTS_PER_SEARCH) but
 * worth revisiting (stream straight to storage) before this is used for very large
 * batch exports. See docs/PRODUCTION_READINESS.md.
 */
export async function processZipGenerate(payload: { downloadJobId: string }): Promise<void> {
  const prisma = getPrisma()
  const job = await prisma.downloadJob.findUnique({ where: { id: payload.downloadJobId } })
  if (!job) return
  if (job.status === 'COMPLETED') return // idempotent — already done

  await prisma.downloadJob.update({ where: { id: job.id }, data: { status: 'PROCESSING' } })

  try {
    const guestSession = await prisma.guestSession.findUnique({ where: { id: job.guestSessionId } })
    if (!guestSession) throw new Error('Guest session no longer exists')

    const photoIds = job.photoIds as string[]
    const photos = await prisma.photo.findMany({
      where: {
        id: { in: photoIds },
        eventId: guestSession.eventId,
        deletedAt: null,
        isArchived: false,
        status: { in: ['PROCESSED'] },
      },
    })
    if (photos.length === 0) throw new Error('No downloadable photos found for this selection')

    const storage = getStorageProvider()
    const zipBuffer = await new Promise<Buffer>((resolve, reject) => {
      const archive = archiver('zip', { zlib: { level: 9 } })
      const chunks: Buffer[] = []
      archive.on('data', (chunk) => chunks.push(chunk))
      archive.on('end', () => resolve(Buffer.concat(chunks)))
      archive.on('error', reject)

      void (async () => {
        try {
          for (const photo of photos) {
            const key = photo.previewKey ?? photo.originalKey
            const buffer = await storage.getObject(key)
            archive.append(buffer, { name: `${photo.id}-${photo.originalFilename.replace(/[/\\]/g, '_')}` })
          }
          await archive.finalize()
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)))
        }
      })()
    })

    const zipKey = storageKeys.zip(guestSession.eventId, job.id)
    await storage.putObject({ key: zipKey, body: zipBuffer, contentType: 'application/zip' })

    await prisma.downloadJob.update({
      where: { id: job.id },
      data: { status: 'COMPLETED', zipKey, completedAt: new Date(), errorMessage: null },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error({ downloadJobId: job.id }, `ZIP generation failed: ${message}`)
    await prisma.downloadJob.update({ where: { id: job.id }, data: { status: 'FAILED', errorMessage: message } })
    throw err
  }
}
