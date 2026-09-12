import { getPrisma } from '../../db.js'
import { getFaceSearchProvider } from '../../providers/faceSearch/index.js'
import { logger } from '../../lib/logger.js'

/** Idempotent — safe to run twice (e.g. a retried job after a partial failure). */
export async function processEventCollectionDelete(payload: { eventId: string }): Promise<void> {
  const prisma = getPrisma()
  const event = await prisma.event.findUnique({ where: { id: payload.eventId } })
  if (!event) return

  await getFaceSearchProvider().deleteEventCollection(payload.eventId)
  await prisma.indexedFace.deleteMany({ where: { eventId: payload.eventId } })
  await prisma.event.update({ where: { id: payload.eventId }, data: { faceCollectionReady: false } })
  logger.info({ eventId: payload.eventId }, 'Event face collection deleted')
}
