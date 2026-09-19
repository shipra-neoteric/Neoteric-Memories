import type { ConsentSubmitInput } from '@neoteric-memories/shared'
import { getPrisma } from '../../db.js'
import { Errors } from '../../lib/errors.js'

export async function submitConsent(
  sessionId: string,
  eventId: string,
  input: ConsentSubmitInput,
  ctx: { ipHash: string; userAgent?: string }
) {
  const prisma = getPrisma()
  const event = await prisma.event.findUnique({ where: { id: eventId } })
  if (!event?.consentVersionId) throw Errors.conflict('This event has no consent version configured yet')

  const version = await prisma.consentVersion.findUnique({ where: { id: event.consentVersionId } })
  if (!version) throw Errors.conflict('This event has no consent version configured yet')

  // The zod schema at the route level can't know which of the 5 possible items this
  // specific consent version actually enabled (an admin can toggle each on/off per
  // version — see consentVersionCreateSchema's own doc comment), so the real "did
  // the guest accept everything this version requires" check happens here instead,
  // against the version's own requiredText keys.
  const requiredKeys = Object.keys(version.requiredText as Record<string, string>)
  const accepted = input.required as Record<string, boolean | undefined>
  const missing = requiredKeys.filter((key) => accepted[key] !== true)
  if (missing.length > 0) throw Errors.badRequest('All required consent items must be accepted')

  return prisma.consentRecord.create({
    data: {
      guestSessionId: sessionId,
      eventId,
      consentVersionId: event.consentVersionId,
      requiredAccepted: input.required,
      optionalAccepted: input.optional,
      guardianAssisted: input.guardianAssisted,
      ipHash: ctx.ipHash,
      userAgent: ctx.userAgent,
    },
  })
}

export async function hasValidConsent(sessionId: string): Promise<boolean> {
  const count = await getPrisma().consentRecord.count({ where: { guestSessionId: sessionId } })
  return count > 0
}
