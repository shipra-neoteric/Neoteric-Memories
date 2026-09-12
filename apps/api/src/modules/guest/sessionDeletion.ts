import { getPrisma } from '../../db.js'
import { getStorageProvider } from '../../providers/storage/index.js'

/**
 * Self-service "delete my search/session data". Removes search/match/download
 * artifacts and scrubs correlation hashes from the session row. ConsentRecord is
 * intentionally kept (it contains no biometric data) as Neoteric's proof that
 * consent was captured — see docs/PRIVACY.md for the reasoning.
 */
export async function deleteGuestSessionData(sessionId: string): Promise<void> {
  const prisma = getPrisma()
  const searches = await prisma.faceSearch.findMany({ where: { guestSessionId: sessionId }, select: { id: true } })
  const searchIds = searches.map((s) => s.id)

  if (searchIds.length > 0) {
    await prisma.faceMatch.deleteMany({ where: { faceSearchId: { in: searchIds } } })
  }

  const downloadJobs = await prisma.downloadJob.findMany({ where: { guestSessionId: sessionId } })
  const storage = getStorageProvider()
  for (const job of downloadJobs) {
    if (job.zipKey) await storage.deleteObject(job.zipKey)
  }
  await prisma.downloadJob.deleteMany({ where: { guestSessionId: sessionId } })
  await prisma.faceSearch.deleteMany({ where: { guestSessionId: sessionId } })

  await prisma.guestSession.update({
    where: { id: sessionId },
    data: { status: 'DELETED', deletedAt: new Date(), ipHash: 'deleted', deviceHash: 'deleted', userAgent: null },
  })
}
