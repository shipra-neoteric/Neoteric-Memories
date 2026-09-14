import type { Permission } from '@neoteric-memories/shared'
import type { NextFunction, Request, Response } from 'express'
import { COOKIE_NAMES } from '../lib/cookies.js'
import { Errors } from '../lib/errors.js'
import { verifyAccessToken } from '../lib/jwt.js'
import { getPrisma } from '../db.js'
import { asyncHandler } from './asyncHandler.js'

export const requireAuth = asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
  const token = req.cookies?.[COOKIE_NAMES.ACCESS]
  if (!token) throw Errors.unauthorized()

  let payload
  try {
    payload = verifyAccessToken(token)
  } catch {
    throw Errors.unauthorized('Session expired, please sign in again')
  }

  const user = await getPrisma().user.findUnique({ where: { id: payload.sub } })
  if (!user || !user.isActive) throw Errors.unauthorized('Account is inactive or no longer exists')

  req.user = { id: user.id, role: user.role, name: user.name, permissions: user.permissions as Permission[] }
  next()
})

/** Same-origin, header-echo CSRF check for cookie-authenticated state-changing admin requests. */
export function requireCsrf(req: Request, _res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next()
  const cookieToken = req.cookies?.[COOKIE_NAMES.CSRF]
  const headerToken = req.header('x-csrf-token')
  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    throw Errors.forbidden('Missing or invalid CSRF token')
  }
  next()
}
