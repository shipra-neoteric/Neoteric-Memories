import crypto from 'node:crypto'
import { env } from '../env.js'

/**
 * Proves "this caller was handed this guest session" without a cookie — the guest
 * app and API live on different domains in production, and a cross-site cookie gets
 * silently dropped by Safari ITP and most in-app browsers (WhatsApp/Instagram),
 * which broke gallery access on some devices. The token is an HMAC over the session
 * id, sent back to the client once and echoed on every later guest request as the
 * X-Guest-Token header/localStorage value instead of a Set-Cookie.
 */
export function signGuestToken(sessionId: string): string {
  return crypto.createHmac('sha256', env.JWT_SECRET).update(sessionId).digest('base64url')
}

export function verifyGuestToken(sessionId: string, token: string): boolean {
  const expected = Buffer.from(signGuestToken(sessionId))
  const actual = Buffer.from(token)
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual)
}
