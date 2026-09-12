import { getPrisma } from '../../db.js'
import { Errors } from '../../lib/errors.js'

export async function reportWrongMatch(searchId: string, guestSessionId: string, photoId: string, note: string | undefined) {
  const prisma = getPrisma()
  const search = await prisma.faceSearch.findUnique({ where: { id: searchId } })
  if (!search || search.guestSessionId !== guestSessionId) throw Errors.forbidden('That search does not belong to your session')

  const match = await prisma.faceMatch.findFirst({ where: { faceSearchId: searchId, photoId } })
  if (!match) throw Errors.badRequest('That photo was not part of your search results')

  return prisma.wrongMatchReport.create({
    data: { eventId: search.eventId, guestSessionId, photoId, note },
  })
}
