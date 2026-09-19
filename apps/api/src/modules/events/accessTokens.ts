import QRCode from 'qrcode'
import { getPrisma } from '../../db.js'
import { generateSecureToken, hashToken } from '../../lib/hash.js'
import { env } from '../../env.js'
import { DEFAULTS } from '@neoteric-memories/shared'
import { Errors } from '../../lib/errors.js'
import { writeAuditLog } from '../audit/service.js'

export interface GeneratedAccessToken {
  rawToken: string
  guestUrl: string
  qrPngDataUrl: string
  expiresAt: Date
}

/** Builds the guest URL + QR PNG for a raw token — shared by both a fresh generate and a re-display of an already-issued one. */
async function buildGuestUrlAndQr(rawToken: string, baseUrl?: string): Promise<{ guestUrl: string; qrPngDataUrl: string }> {
  const appBase = baseUrl ? baseUrl.replace(/\/$/, '') : env.APP_BASE_URL
  const guestUrl = `${appBase}/e/${rawToken}`
  const qrPngDataUrl = await QRCode.toDataURL(guestUrl, { errorCorrectionLevel: 'M', margin: 2, width: 512 })
  return { guestUrl, qrPngDataUrl }
}

/**
 * The raw token is now persisted alongside its hash (see schema.prisma's own doc
 * comment on EventAccessToken.rawToken) specifically so the SAME link can be shown
 * again later via getCurrentEventAccessToken, instead of every re-view requiring a
 * regenerate that invalidates whatever QR/link was already printed/shared.
 * Regenerating (this function) still creates a brand new token and immediately
 * revokes the old one — that's still the only way to actually rotate the link, e.g.
 * if it leaked.
 */
export async function generateEventAccessToken(
  eventId: string,
  actor: { id: string; role: string },
  baseUrl?: string
): Promise<GeneratedAccessToken> {
  const prisma = getPrisma()
  const event = await prisma.event.findUnique({ where: { id: eventId } })
  if (!event || event.deletedAt) throw Errors.notFound('Event not found')

  await prisma.eventAccessToken.updateMany({
    where: { eventId, isActive: true },
    data: { isActive: false, revokedAt: new Date(), revokedReason: 'Superseded by a regenerated QR code' },
  })

  const rawToken = generateSecureToken(DEFAULTS.QR_TOKEN_BYTES)
  const expiresAt = event.guestAccessExpiresAt
  await prisma.eventAccessToken.create({
    data: { eventId, tokenHash: hashToken(rawToken), rawToken, expiresAt, createdById: actor.id },
  })

  const { guestUrl, qrPngDataUrl } = await buildGuestUrlAndQr(rawToken, baseUrl)

  await writeAuditLog({ actorId: actor.id, actorRole: actor.role, action: 'event.access_token_generated', entityType: 'Event', entityId: eventId, eventId })

  return { rawToken, guestUrl, qrPngDataUrl, expiresAt }
}

/**
 * Re-displays the event's current active token (if any) without creating a new one
 * or touching the old one at all — what the event page calls on load so an
 * already-generated QR/link just shows up again instead of requiring
 * "Regenerate". Returns null when there's no active, non-expired token (or it
 * predates this field and has no rawToken on file — those can only be regenerated).
 */
export async function getCurrentEventAccessToken(eventId: string, baseUrl?: string): Promise<GeneratedAccessToken | null> {
  const prisma = getPrisma()
  const token = await prisma.eventAccessToken.findFirst({
    where: { eventId, isActive: true, expiresAt: { gt: new Date() }, rawToken: { not: null } },
    orderBy: { createdAt: 'desc' },
  })
  if (!token?.rawToken) return null

  const { guestUrl, qrPngDataUrl } = await buildGuestUrlAndQr(token.rawToken, baseUrl)
  return { rawToken: token.rawToken, guestUrl, qrPngDataUrl, expiresAt: token.expiresAt }
}

export async function revokeEventAccessTokens(
  eventId: string,
  reason: string,
  actor: { id: string; role: string }
): Promise<number> {
  const prisma = getPrisma()
  const result = await prisma.eventAccessToken.updateMany({
    where: { eventId, isActive: true },
    data: { isActive: false, revokedAt: new Date(), revokedReason: reason },
  })
  await writeAuditLog({ actorId: actor.id, actorRole: actor.role, action: 'event.access_disabled', entityType: 'Event', entityId: eventId, eventId, metadata: { reason } })
  return result.count
}

export type GuestAccessDenialReason =
  | 'INVALID'
  | 'EXPIRED'
  | 'REVOKED'
  | 'NOT_OPEN_YET'
  | 'PAUSED'
  | 'CLOSED'
  | 'NOT_READY'

export async function resolveGuestAccessToken(rawToken: string) {
  const prisma = getPrisma()
  const tokenHash = hashToken(rawToken)
  const token = await prisma.eventAccessToken.findUnique({ where: { tokenHash } })
  if (!token) return { ok: false as const, reason: 'INVALID' as const }
  if (!token.isActive || token.revokedAt) return { ok: false as const, reason: 'REVOKED' as const }
  if (token.expiresAt < new Date()) return { ok: false as const, reason: 'EXPIRED' as const }

  const event = await prisma.event.findUnique({ where: { id: token.eventId } })
  if (!event || event.deletedAt) return { ok: false as const, reason: 'INVALID' as const }

  const now = new Date()
  if (event.status === 'PAUSED') return { ok: false as const, reason: 'PAUSED' as const }
  if (event.status === 'CLOSED' || event.status === 'ARCHIVED') return { ok: false as const, reason: 'CLOSED' as const }
  if (event.status === 'EXPIRED') return { ok: false as const, reason: 'EXPIRED' as const }
  if (event.status !== 'LIVE') return { ok: false as const, reason: 'NOT_READY' as const }
  if (now < event.guestAccessOpensAt) return { ok: false as const, reason: 'NOT_OPEN_YET' as const }
  if (now > event.guestAccessExpiresAt) return { ok: false as const, reason: 'EXPIRED' as const }

  return { ok: true as const, event }
}
