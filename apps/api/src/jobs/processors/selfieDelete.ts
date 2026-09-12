import { getPrisma } from '../../db.js'
import { getStorageProvider } from '../../providers/storage/index.js'
import { storageKeys } from '../../lib/storageKeys.js'
import { logger } from '../../lib/logger.js'
import { writeSecurityEvent } from '../../modules/audit/service.js'

/**
 * Deletes the raw selfie image immediately after matching. This is the primary path;
 * the retention sweep (retentionSweep.ts) is the 24h hard-upper-bound safety net for
 * when this job fails outright ("Selfie deletion failure requiring an alert").
 */
export async function processSelfieDelete(payload: { faceSearchId: string }): Promise<void> {
  const prisma = getPrisma()
  const search = await prisma.faceSearch.findUnique({ where: { id: payload.faceSearchId } })
  if (!search) return
  if (search.selfieDeletedAt) return // idempotent — already deleted

  try {
    await getStorageProvider().deleteObject(storageKeys.selfie(search.eventId, search.id))
    await prisma.faceSearch.update({ where: { id: search.id }, data: { selfieDeletedAt: new Date() } })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.error({ faceSearchId: search.id }, `Selfie deletion failed: ${message}`)
    await writeSecurityEvent({
      type: 'SUSPICIOUS_ACTIVITY',
      severity: 'CRITICAL',
      eventId: search.eventId,
      detail: { reason: 'selfie_delete_failure', faceSearchId: search.id, message },
    })
    throw err
  }
}
