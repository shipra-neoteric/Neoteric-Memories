import { getPrisma } from '../../db.js'
import { getStorageProvider } from '../../providers/storage/index.js'
import { getFaceSearchProvider } from '../../providers/faceSearch/index.js'
import { writeAuditLog } from '../audit/service.js'

/**
 * Hard delete of everything belonging to an event, including provider-side biometric
 * state. MongoDB has no cascading foreign keys, so every collection is cleaned up
 * explicitly here. This is what "delete event data" must actually do — soft-deleting
 * the Event row alone would leave biometric records behind, which the spec
 * explicitly forbids ("ensure biometric/provider records are actually removed").
 */
export async function deleteEventCascade(eventId: string, actor: { id: string; role: string }): Promise<void> {
  const prisma = getPrisma()
  const event = await prisma.event.findUnique({ where: { id: eventId } })
  if (!event) return

  await getFaceSearchProvider().deleteEventCollection(eventId)

  const photos = await prisma.photo.findMany({ where: { eventId }, select: { id: true, originalKey: true, thumbnailKey: true, previewKey: true } })
  const storage = getStorageProvider()
  const keysToDelete: string[] = []
  for (const p of photos) {
    keysToDelete.push(p.originalKey)
    if (p.thumbnailKey) keysToDelete.push(p.thumbnailKey)
    if (p.previewKey) keysToDelete.push(p.previewKey)
  }
  if (event.coverImageKey) keysToDelete.push(event.coverImageKey)
  if (keysToDelete.length > 0) await storage.deleteObjects(keysToDelete)

  await prisma.indexedFace.deleteMany({ where: { eventId } })
  const searches = await prisma.faceSearch.findMany({ where: { eventId }, select: { id: true } })
  const searchIds = searches.map((s) => s.id)
  if (searchIds.length > 0) await prisma.faceMatch.deleteMany({ where: { faceSearchId: { in: searchIds } } })
  await prisma.faceSearch.deleteMany({ where: { eventId } })

  const guestSessions = await prisma.guestSession.findMany({ where: { eventId }, select: { id: true } })
  const guestSessionIds = guestSessions.map((s) => s.id)
  if (guestSessionIds.length > 0) {
    await prisma.downloadJob.deleteMany({ where: { guestSessionId: { in: guestSessionIds } } })
    await prisma.consentRecord.deleteMany({ where: { guestSessionId: { in: guestSessionIds } } })
  }
  await prisma.guestSession.deleteMany({ where: { eventId } })

  await prisma.wrongMatchReport.deleteMany({ where: { eventId } })
  await prisma.photo.deleteMany({ where: { eventId } })
  await prisma.photoBatch.deleteMany({ where: { eventId } })
  await prisma.eventAssignment.deleteMany({ where: { eventId } })
  await prisma.eventAccessToken.deleteMany({ where: { eventId } })
  await prisma.event.delete({ where: { id: eventId } })

  await writeAuditLog({
    actorId: actor.id,
    actorRole: actor.role,
    action: 'event.delete',
    entityType: 'Event',
    entityId: eventId,
    metadata: { photoCount: photos.length },
  })
}
