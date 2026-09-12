import crypto from 'node:crypto'
import { env } from '../env.js'

interface OAuthStatePayload {
  eventId: string
  userId: string
  ts: number
}

const MAX_AGE_MS = 10 * 60 * 1000 // the OAuth roundtrip must complete within 10 minutes

/** Signs eventId+userId+timestamp so the OAuth callback can trust which event/admin initiated the connect flow, without needing server-side session storage for the `state` param. */
export function signOAuthState(eventId: string, userId: string): string {
  const payload: OAuthStatePayload = { eventId, userId, ts: Date.now() }
  const json = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = crypto.createHmac('sha256', env.COOKIE_SECRET).update(json).digest('base64url')
  return `${json}.${sig}`
}

export function verifyOAuthState(state: string, expectedUserId: string): { eventId: string } {
  const [json, sig] = state.split('.')
  if (!json || !sig) throw new Error('Malformed OAuth state')
  const expectedSig = crypto.createHmac('sha256', env.COOKIE_SECRET).update(json).digest('base64url')
  const a = Buffer.from(sig)
  const b = Buffer.from(expectedSig)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error('Invalid OAuth state signature')

  const payload = JSON.parse(Buffer.from(json, 'base64url').toString('utf8')) as OAuthStatePayload
  if (Date.now() - payload.ts > MAX_AGE_MS) throw new Error('OAuth state expired — please try connecting again')
  if (payload.userId !== expectedUserId) throw new Error('OAuth state does not match the signed-in admin')
  return { eventId: payload.eventId }
}
