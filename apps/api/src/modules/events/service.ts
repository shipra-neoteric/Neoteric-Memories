import type { EventCreateInput, EventUpdateInput } from '@neoteric-memories/shared'
import { getPrisma } from '../../db.js'
import { Errors } from '../../lib/errors.js'
import { getFaceSearchProvider } from '../../providers/faceSearch/index.js'
import { writeAuditLog } from '../audit/service.js'
import { assertValidTransition } from './lifecycle.js'
import { checkEventReadiness } from './readiness.js'

export async function createEvent(input: EventCreateInput, actor: { id: string; role: string }) {
  const prisma = getPrisma()
  if (input.endAt < input.startAt) throw Errors.badRequest('Event end time must be after the start time')
  if (input.guestAccessExpiresAt <= input.guestAccessOpensAt) {
    throw Errors.badRequest('Guest access expiry must be after guest access opens')
  }

  const event = await prisma.event.create({
    data: {
      name: input.name,
      type: input.type,
      siteId: input.siteId,
      venue: input.venue,
      description: input.description,
      startAt: input.startAt,
      endAt: input.endAt,
      guestAccessOpensAt: input.guestAccessOpensAt,
      guestAccessExpiresAt: input.guestAccessExpiresAt,
      faceIndexDeleteAt: input.faceIndexDeleteAt,
      originalPhotoRetentionUntil: input.originalPhotoRetentionUntil,
      consentVersionId: input.consentVersionId,
      matchThreshold: input.matchThreshold,
      likelyIncludesChildren: input.likelyIncludesChildren,
      guardianAssistedFlow: input.guardianAssistedFlow,
      selfieUploadFallbackEnabled: input.selfieUploadFallbackEnabled,
      status: 'DRAFT',
      faceCollectionId: 'pending', // replaced immediately below once we have the real id
      createdById: actor.id,
      // Explicitly written (not left implicit/absent) — Prisma's MongoDB connector's
      // `{ deletedAt: null }` filter (used everywhere to mean "not soft-deleted")
      // only matches documents where the field is actually present and null, NOT
      // documents where it was simply never set. See photos/service.ts for the same
      // fix and the same reasoning.
      deletedAt: null,
    },
  })

  const faceCollectionId = `neoteric-event-${event.id}`
  await getFaceSearchProvider().createEventCollection(event.id)
  const updated = await prisma.event.update({ where: { id: event.id }, data: { faceCollectionId, faceCollectionReady: true } })

  await writeAuditLog({ actorId: actor.id, actorRole: actor.role, action: 'event.create', entityType: 'Event', entityId: event.id, siteId: input.siteId, eventId: event.id })
  return updated
}

export async function updateEvent(eventId: string, input: EventUpdateInput, actor: { id: string; role: string }) {
  const prisma = getPrisma()
  const existing = await prisma.event.findUnique({ where: { id: eventId } })
  if (!existing || existing.deletedAt) throw Errors.notFound('Event not found')

  const event = await prisma.event.update({ where: { id: eventId }, data: input })
  await writeAuditLog({ actorId: actor.id, actorRole: actor.role, action: 'event.update', entityType: 'Event', entityId: eventId, eventId })
  return event
}

export async function transitionEventStatus(
  eventId: string,
  target: 'LIVE' | 'PAUSED' | 'CLOSED' | 'ARCHIVED',
  reason: string | undefined,
  actor: { id: string; role: string }
) {
  const prisma = getPrisma()
  let event = await prisma.event.findUnique({ where: { id: eventId } })
  if (!event || event.deletedAt) throw Errors.notFound('Event not found')

  if (target === 'LIVE') {
    // checkEventReadiness has a side effect of promoting DRAFT/UPLOADING/PROCESSING
    // to READY once its criteria are met — it must run (and its promotion be
    // re-read) *before* we validate the transition below, otherwise an event whose
    // last photo just finished processing would incorrectly appear stuck in
    // UPLOADING with no valid path to LIVE, even though it actually meets every
    // go-live criterion.
    const readiness = await checkEventReadiness(eventId)
    if (!readiness.ready) {
      throw Errors.conflict(`Event is not ready to go live: ${readiness.reasons.join('; ')}`)
    }
    event = await prisma.event.findUnique({ where: { id: eventId } })
    if (!event) throw Errors.notFound('Event not found')
  }

  assertValidTransition(event.status, target)

  const data: Record<string, unknown> = { status: target }
  if (target === 'CLOSED') data.closedAt = new Date()
  if (target === 'ARCHIVED') data.archivedAt = new Date()

  const updated = await prisma.event.update({ where: { id: eventId }, data })
  await writeAuditLog({
    actorId: actor.id,
    actorRole: actor.role,
    action: `event.status_${target.toLowerCase()}`,
    entityType: 'Event',
    entityId: eventId,
    eventId,
    metadata: { reason },
  })
  return updated
}

export async function assignEventMember(eventId: string, userId: string, role: 'EVENT_MANAGER' | 'PHOTOGRAPHER', actor: { id: string; role: string }) {
  const prisma = getPrisma()
  const assignment = await prisma.eventAssignment.upsert({
    where: { eventId_userId: { eventId, userId } },
    create: { eventId, userId, role },
    update: { role },
  })
  await writeAuditLog({ actorId: actor.id, actorRole: actor.role, action: 'event.assign_member', entityType: 'Event', entityId: eventId, eventId, metadata: { userId, role } })
  return assignment
}

export async function unassignEventMember(eventId: string, userId: string, actor: { id: string; role: string }) {
  const prisma = getPrisma()
  await prisma.eventAssignment.deleteMany({ where: { eventId, userId } })
  await writeAuditLog({ actorId: actor.id, actorRole: actor.role, action: 'event.unassign_member', entityType: 'Event', entityId: eventId, eventId, metadata: { userId } })
}
