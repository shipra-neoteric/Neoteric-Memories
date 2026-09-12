import { DEFAULTS } from '@neoteric-memories/shared'
import { getPrisma } from '../../db.js'
import { Errors } from '../../lib/errors.js'
import { writeSecurityEvent } from '../audit/service.js'

export async function getOrCreateGuestSession(
  eventId: string,
  existingSessionId: string | undefined,
  ctx: { ipHash: string; deviceHash: string; userAgent?: string }
) {
  const prisma = getPrisma()

  if (existingSessionId) {
    const existing = await prisma.guestSession.findUnique({ where: { id: existingSessionId } })
    if (existing && existing.eventId === eventId && existing.status === 'ACTIVE' && existing.expiresAt > new Date()) {
      return existing
    }
  }

  return prisma.guestSession.create({
    data: {
      eventId,
      ipHash: ctx.ipHash,
      deviceHash: ctx.deviceHash,
      userAgent: ctx.userAgent,
      expiresAt: new Date(Date.now() + DEFAULTS.GUEST_SESSION_TTL_HOURS * 60 * 60 * 1000),
      // See the same fix (and reasoning) in photos/service.ts and events/service.ts.
      deletedAt: null,
    },
  })
}

export async function requireActiveSession(sessionId: string) {
  const prisma = getPrisma()
  const session = await prisma.guestSession.findUnique({ where: { id: sessionId } })
  if (!session) throw Errors.notFound('Session not found')
  if (session.status !== 'ACTIVE' || session.expiresAt < new Date()) {
    throw Errors.gone('Your session has expired. Please scan the QR code again to start a new search.')
  }
  return session
}

export async function requireLiveEventForSession(eventId: string) {
  const prisma = getPrisma()
  const event = await prisma.event.findUnique({ where: { id: eventId } })
  if (!event || event.deletedAt) throw Errors.notFound('Event not found')
  if (event.status === 'PAUSED') {
    throw Errors.conflict('This event has been temporarily paused by the organizer. Please try again later.')
  }
  if (event.status !== 'LIVE') {
    throw Errors.conflict('Guest access to this event is not currently open.')
  }
  return event
}

export async function checkAndIncrementSelfieAttempt(sessionId: string): Promise<void> {
  const prisma = getPrisma()
  const session = await prisma.guestSession.findUniqueOrThrow({ where: { id: sessionId } })
  if (session.selfieAttempts >= DEFAULTS.MAX_SELFIE_ATTEMPTS_PER_SESSION) {
    await writeSecurityEvent({ type: 'SELFIE_ATTEMPTS_EXCEEDED', eventId: session.eventId, guestSessionId: sessionId, deviceHash: session.deviceHash })
    throw Errors.tooManyRequests('You have reached the maximum number of selfie attempts for this session. Please contact event staff for help.')
  }
  await prisma.guestSession.update({ where: { id: sessionId }, data: { selfieAttempts: { increment: 1 } } })
}

export async function checkDeviceSearchLimit(eventId: string, deviceHash: string): Promise<void> {
  const prisma = getPrisma()
  const sessions = await prisma.guestSession.findMany({ where: { eventId, deviceHash }, select: { searchCount: true } })
  const total = sessions.reduce((sum, s) => sum + s.searchCount, 0)
  if (total >= DEFAULTS.MAX_SEARCHES_PER_DEVICE_PER_EVENT) {
    await writeSecurityEvent({ type: 'SEARCH_LIMIT_EXCEEDED', eventId, deviceHash })
    throw Errors.tooManyRequests('You have reached the maximum number of searches for this event on this device.')
  }
}
