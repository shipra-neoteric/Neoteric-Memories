import { Router } from 'express'
import multer from 'multer'
import { z } from 'zod'
import {
  eventCreateSchema,
  eventUpdateSchema,
  eventAssignmentSchema,
  eventStatusTransitionSchema,
  objectIdSchema,
} from '@neoteric-memories/shared'
import { asyncHandler } from '../../middleware/asyncHandler.js'
import { validateBody, validateParams } from '../../middleware/validate.js'
import { requirePermission, requireEventAssignment, requireSiteAccess } from '../../middleware/rbac.js'
import { getPrisma } from '../../db.js'
import { Errors } from '../../lib/errors.js'
import { getFaceSearchProvider } from '../../providers/faceSearch/index.js'
import { getStorageProvider } from '../../providers/storage/index.js'
import { sniffImageType, extensionForType } from '../../lib/fileValidation.js'
import { storageKeys } from '../../lib/storageKeys.js'
import * as eventService from './service.js'
import { generateEventAccessToken, revokeEventAccessTokens } from './accessTokens.js'
import { checkEventReadiness } from './readiness.js'
import { deleteEventCascade } from './deleteEventCascade.js'
import { scopedEventWhere } from './scoping.js'

export const eventsRouter = Router()
const idParams = z.object({ id: objectIdSchema })
const memberParams = z.object({ id: objectIdSchema, userId: objectIdSchema })

eventsRouter.get(
  '/',
  requirePermission('event:view'),
  asyncHandler(async (req, res) => {
    const where = await scopedEventWhere(req.user!)
    const events = await getPrisma().event.findMany({ where, orderBy: { startAt: 'desc' } })
    res.json({ events })
  })
)

eventsRouter.post(
  '/',
  requirePermission('event:create'),
  validateBody(eventCreateSchema),
  requireSiteAccess((req) => req.body.siteId),
  asyncHandler(async (req, res) => {
    const event = await eventService.createEvent(req.body, req.user!)
    res.status(201).json({ event })
  })
)

eventsRouter.get(
  '/:id',
  requirePermission('event:view'),
  validateParams(idParams),
  requireEventAssignment((req) => req.params.id),
  asyncHandler(async (req, res) => {
    const prisma = getPrisma()
    const event = await prisma.event.findFirst({ where: { id: req.params.id, deletedAt: null } })
    if (!event) throw Errors.notFound('Event not found')

    const [photoStats, batches, assignments, faceStatus, activeToken] = await Promise.all([
      prisma.photo.groupBy({ by: ['status'], where: { eventId: event.id, deletedAt: null }, _count: true }),
      prisma.photoBatch.findMany({ where: { eventId: event.id }, orderBy: { createdAt: 'desc' } }),
      prisma.eventAssignment.findMany({ where: { eventId: event.id } }),
      getFaceSearchProvider().getProcessingStatus({ eventId: event.id }),
      prisma.eventAccessToken.findFirst({ where: { eventId: event.id, isActive: true }, orderBy: { createdAt: 'desc' } }),
    ])

    res.json({
      event,
      photoStats,
      batches,
      assignments,
      indexedFaceCount: faceStatus.indexedFaceCount,
      hasActiveAccessToken: !!activeToken,
      accessTokenExpiresAt: activeToken?.expiresAt ?? null,
    })
  })
)

eventsRouter.patch(
  '/:id',
  requirePermission('event:edit'),
  validateParams(idParams),
  validateBody(eventUpdateSchema),
  requireEventAssignment((req) => req.params.id),
  asyncHandler(async (req, res) => {
    const event = await eventService.updateEvent(req.params.id, req.body, req.user!)
    res.json({ event })
  })
)

eventsRouter.get(
  '/:id/readiness',
  requirePermission('event:view'),
  validateParams(idParams),
  requireEventAssignment((req) => req.params.id),
  asyncHandler(async (req, res) => {
    const readiness = await checkEventReadiness(req.params.id)
    res.json(readiness)
  })
)

eventsRouter.post(
  '/:id/status',
  requirePermission('event:close'),
  validateParams(idParams),
  validateBody(eventStatusTransitionSchema),
  requireEventAssignment((req) => req.params.id),
  asyncHandler(async (req, res) => {
    const event = await eventService.transitionEventStatus(req.params.id, req.body.status, req.body.reason, req.user!)
    res.json({ event })
  })
)

eventsRouter.post(
  '/:id/access-token',
  requirePermission('event:manage_qr'),
  validateParams(idParams),
  requireEventAssignment((req) => req.params.id),
  asyncHandler(async (req, res) => {
    let origin = req.get('origin')
    if (!origin && req.get('referer')) {
      try {
        origin = new URL(req.get('referer')!).origin
      } catch {
        // ignore malformed referer
      }
    }
    const result = await generateEventAccessToken(req.params.id, req.user!, origin)
    res.json(result)
  })
)

eventsRouter.post(
  '/:id/access-token/revoke',
  requirePermission('event:manage_qr'),
  validateParams(idParams),
  validateBody(z.object({ reason: z.string().max(500).optional() })),
  requireEventAssignment((req) => req.params.id),
  asyncHandler(async (req, res) => {
    const count = await revokeEventAccessTokens(req.params.id, req.body.reason ?? 'Manually disabled by admin', req.user!)
    res.json({ revokedCount: count })
  })
)

eventsRouter.post(
  '/:id/assignments',
  requirePermission('event:manage_assignments'),
  validateParams(idParams),
  validateBody(eventAssignmentSchema),
  asyncHandler(async (req, res) => {
    const assignment = await eventService.assignEventMember(req.params.id, req.body.userId, req.body.role, req.user!)
    res.status(201).json({ assignment })
  })
)

eventsRouter.delete(
  '/:id/assignments/:userId',
  requirePermission('event:manage_assignments'),
  validateParams(memberParams),
  asyncHandler(async (req, res) => {
    await eventService.unassignEventMember(req.params.id, req.params.userId, req.user!)
    res.json({ success: true })
  })
)

const coverUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } })

eventsRouter.post(
  '/:id/cover',
  requirePermission('event:edit'),
  validateParams(idParams),
  requireEventAssignment((req) => req.params.id),
  coverUpload.single('cover'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw Errors.badRequest('No file provided')
    const type = sniffImageType(req.file.buffer)
    if (type === 'unknown' || type === 'heic') throw Errors.badRequest('Cover image must be a JPEG or PNG')

    const key = storageKeys.cover(req.params.id, extensionForType(type))
    await getStorageProvider().putObject({ key, body: req.file.buffer, contentType: type === 'png' ? 'image/png' : 'image/jpeg' })
    const event = await getPrisma().event.update({ where: { id: req.params.id }, data: { coverImageKey: key } })
    res.json({ event })
  })
)

eventsRouter.delete(
  '/:id',
  requirePermission('event:delete'),
  validateParams(idParams),
  asyncHandler(async (req, res) => {
    await deleteEventCascade(req.params.id, req.user!)
    res.json({ success: true })
  })
)
