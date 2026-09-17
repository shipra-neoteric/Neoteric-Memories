import type { NextFunction, Request, Response } from 'express'
import { Errors } from '../lib/errors.js'
import { verifyGuestToken } from '../lib/guestToken.js'

/**
 * The guest journey has no login — the security boundary for "is this really your
 * own gallery" is that a signed token, handed to the client when the session was
 * created, must match the :sessionId in the URL. This stops one guest from viewing
 * another guest's private results by guessing/sharing a session id.
 *
 * This used to be a cookie match, but the guest app and API are on different domains
 * in production, and Safari ITP / in-app browsers (WhatsApp, Instagram) silently
 * drop that cross-site cookie on some devices. A header carrying a signed token
 * (see lib/guestToken.ts) has the same security property without depending on
 * third-party cookies being allowed at all.
 */
export function requireGuestSessionToken(req: Request, _res: Response, next: NextFunction) {
  const token = req.header('x-guest-token')
  const paramSessionId = req.params.sessionId
  if (!token || !paramSessionId || !verifyGuestToken(paramSessionId, token)) {
    throw Errors.forbidden('This gallery link is not associated with your device/session.')
  }
  next()
}
