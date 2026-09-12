import type { NextFunction, Request, Response } from 'express'
import { hasPermission, type Permission } from '@neoteric-memories/shared'
import { Errors } from '../lib/errors.js'
import { getPrisma } from '../db.js'
import { asyncHandler } from './asyncHandler.js'

export function requirePermission(permission: Permission) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw Errors.unauthorized()
    if (!hasPermission(req.user.role, permission)) throw Errors.forbidden()
    next()
  }
}

/**
 * MASTER_ADMIN bypasses all scoping. Other roles must hold a UserSiteAccess row for
 * the site in question — this is what stops, e.g., a Marketing Head at Silver Estate
 * from viewing Regal Garden's events (an explicit L1 edge case: "Unauthorized
 * cross-site access").
 */
export function requireSiteAccess(getSiteId: (req: Request) => string | undefined) {
  return asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw Errors.unauthorized()
    if (req.user.role === 'MASTER_ADMIN') return next()
    const siteId = getSiteId(req)
    if (!siteId) throw Errors.badRequest('siteId is required')
    const access = await getPrisma().userSiteAccess.findUnique({
      where: { userId_siteId: { userId: req.user.id, siteId } },
    })
    if (!access) throw Errors.forbidden('You do not have access to this site')
    next()
  })
}

/**
 * MASTER_ADMIN and MARKETING_HEAD (site-scoped, not event-scoped) bypass this check
 * at the middleware level — their site access is validated separately. EVENT_MANAGER
 * and PHOTOGRAPHER must hold an EventAssignment row for the specific event
 * ("Photographer accessing unassigned event" edge case).
 */
export function requireEventAssignment(getEventId: (req: Request) => string | undefined) {
  return asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw Errors.unauthorized()
    if (req.user.role === 'MASTER_ADMIN' || req.user.role === 'MARKETING_HEAD') return next()
    const eventId = getEventId(req)
    if (!eventId) throw Errors.badRequest('eventId is required')
    const assignment = await getPrisma().eventAssignment.findUnique({
      where: { eventId_userId: { eventId, userId: req.user.id } },
    })
    if (!assignment) throw Errors.forbidden('You are not assigned to this event')
    next()
  })
}
