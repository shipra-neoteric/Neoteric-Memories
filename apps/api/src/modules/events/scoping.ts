import { getPrisma } from '../../db.js'

export async function scopedEventWhere(user: { id: string; role: string }) {
  if (user.role === 'MASTER_ADMIN' || user.role === 'SUPPORT_EXECUTIVE') return { deletedAt: null }
  if (user.role === 'MARKETING_HEAD') {
    const access = await getPrisma().userSiteAccess.findMany({ where: { userId: user.id } })
    return { deletedAt: null, siteId: { in: access.map((a) => a.siteId) } }
  }
  const assignments = await getPrisma().eventAssignment.findMany({ where: { userId: user.id } })
  return { deletedAt: null, id: { in: assignments.map((a) => a.eventId) } }
}
