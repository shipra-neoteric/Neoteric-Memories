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
