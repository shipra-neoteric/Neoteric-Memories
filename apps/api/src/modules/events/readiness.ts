import { getPrisma } from '../../db.js'

export interface ReadinessCheck {
  ready: boolean
  reasons: string[]
}

/**
 * "Prevent an event from going Live until: required details are complete, consent
 * text is assigned, at least one photograph is successfully processed, and retention
 * dates are configured." Retention dates are required at creation time by the schema,
 * so this mostly re-validates consent + at least one processed photo, but checks
 * retention dates too in case of a data migration/edge mutation.
 */
export async function checkEventReadiness(eventId: string): Promise<ReadinessCheck> {
  const prisma = getPrisma()
  const event = await prisma.event.findUnique({ where: { id: eventId } })
  const reasons: string[] = []
  if (!event) return { ready: false, reasons: ['Event not found'] }

  if (!event.consentVersionId) reasons.push('No consent version assigned to this event')
  if (!event.faceIndexDeleteAt || !event.originalPhotoRetentionUntil) reasons.push('Retention dates are not configured')
  if (!event.venue || !event.name) reasons.push('Event name/venue is incomplete')

  const processedCount = await prisma.photo.count({ where: { eventId, status: 'PROCESSED', deletedAt: null } })
  if (processedCount === 0) reasons.push('No photograph has been successfully processed with at least one detected face yet')

  const readyByCriteria = reasons.length === 0

  // Recompute the READY status transition as a side effect once the guest-facing
  // criteria are met from a non-live state — this is what moves DRAFT/UPLOADING/
  // PROCESSING to READY automatically as photos finish processing.
  if (readyByCriteria && ['DRAFT', 'UPLOADING', 'PROCESSING'].includes(event.status)) {
    await prisma.event.update({ where: { id: eventId }, data: { status: 'READY' } })
  }

  return { ready: readyByCriteria, reasons }
}
