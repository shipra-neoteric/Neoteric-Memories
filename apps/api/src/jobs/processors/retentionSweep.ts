import { DEFAULTS } from '@neoteric-memories/shared'
import { getPrisma } from '../../db.js'
import { getStorageProvider } from '../../providers/storage/index.js'
import { logger } from '../../lib/logger.js'
import { writeAuditLog, writeSecurityEvent } from '../../modules/audit/service.js'
import { enqueueJob } from '../queue.js'
import { processSelfieDelete } from './selfieDelete.js'

export interface RetentionSweepResult {
  guestSessionsExpired: number
  selfiesForceDeleted: number
  eventCollectionsQueuedForDeletion: number
  eventsExpired: number
  downloadZipsCleaned: number
}

/**
 * Idempotent, safe to run repeatedly (from the worker's periodic schedule, from a
 * cron-triggered BACKGROUND_JOB entry, or manually from an admin "run retention now"
 * action). Called directly (not just via the job queue) so it's easy to unit test.
 */
export async function runRetentionSweep(): Promise<RetentionSweepResult> {
  const prisma = getPrisma()
  const now = new Date()
  const result: RetentionSweepResult = {
    guestSessionsExpired: 0,
    selfiesForceDeleted: 0,
    eventCollectionsQueuedForDeletion: 0,
    eventsExpired: 0,
    downloadZipsCleaned: 0,
  }

  const expiredSessions = await prisma.guestSession.updateMany({
    where: { status: 'ACTIVE', expiresAt: { lte: now } },
    data: { status: 'EXPIRED' },
  })
  result.guestSessionsExpired = expiredSessions.count

  // Hard-upper-bound safety net: any selfie still not deleted past its max retention window is a failure of the immediate-delete path and must be force-deleted + alerted, not silently retried forever.
  const selfieCutoff = new Date(now.getTime() - DEFAULTS.SELFIE_MAX_RETENTION_HOURS * 60 * 60 * 1000)
  const staleSelfies = await prisma.faceSearch.findMany({
    where: { selfieDeletedAt: null, status: { in: ['COMPLETED', 'FAILED'] }, createdAt: { lte: selfieCutoff } },
  })
  for (const search of staleSelfies) {
    try {
      await processSelfieDelete({ faceSearchId: search.id })
      result.selfiesForceDeleted += 1
      await writeSecurityEvent({
        type: 'SUSPICIOUS_ACTIVITY',
        severity: 'WARN',
        eventId: search.eventId,
        detail: { reason: 'selfie_force_deleted_by_retention_sweep', faceSearchId: search.id },
      })
    } catch {
      // processSelfieDelete already logged a CRITICAL security event on failure.
    }
  }

  const dueCollections = await prisma.event.findMany({
    where: { faceCollectionReady: true, faceIndexDeleteAt: { lte: now }, deletedAt: null },
    select: { id: true },
  })
  for (const event of dueCollections) {
    await enqueueJob('EVENT_COLLECTION_DELETE', { eventId: event.id }, `event-collection-delete:${event.id}`)
    result.eventCollectionsQueuedForDeletion += 1
  }

  const expiredEvents = await prisma.event.updateMany({
    where: { status: 'LIVE', guestAccessExpiresAt: { lte: now } },
    data: { status: 'EXPIRED' },
  })
  result.eventsExpired = expiredEvents.count

  const staleZips = await prisma.downloadJob.findMany({
    where: { status: 'COMPLETED', signedUrlExpiresAt: { lte: now }, zipKey: { not: null } },
  })
  const storage = getStorageProvider()
  for (const job of staleZips) {
    if (!job.zipKey) continue
    await storage.deleteObject(job.zipKey)
    await prisma.downloadJob.update({ where: { id: job.id }, data: { status: 'EXPIRED' } })
    result.downloadZipsCleaned += 1
  }

  await writeAuditLog({ action: 'retention.sweep_completed', entityType: 'System', metadata: { ...result } })
  logger.info({ ...result }, 'Retention sweep completed')
  return result
}
