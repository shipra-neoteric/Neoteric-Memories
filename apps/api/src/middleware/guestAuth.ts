import type { NextFunction, Request, Response } from 'express'
import { COOKIE_NAMES } from '../lib/cookies.js'
import { Errors } from '../lib/errors.js'

/**
 * The guest journey has no login — the security boundary for "is this really your
 * own gallery" is that the httpOnly session cookie set when the session was created
 * must match the :sessionId in the URL. This stops one guest from viewing another
 * guest's private results by guessing/sharing a session id.
 */
export function requireGuestSessionCookie(req: Request, _res: Response, next: NextFunction) {
  const cookieSessionId = req.cookies?.[COOKIE_NAMES.GUEST]
  const paramSessionId = req.params.sessionId
  if (!cookieSessionId || cookieSessionId !== paramSessionId) {
    throw Errors.forbidden('This gallery link is not associated with your device/session.')
  }
  next()
}
