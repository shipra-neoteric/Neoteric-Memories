import { Router } from 'express'
import multer from 'multer'
import { z } from 'zod'
import { DEFAULTS, objectIdSchema, paginationSchema } from '@neoteric-memories/shared'
import { asyncHandler } from '../../middleware/asyncHandler.js'
import { validateParams, validateQuery, validateBody } from '../../middleware/validate.js'
import { requirePermission, requireEventAssignment } from '../../middleware/rbac.js'
import { getPrisma } from '../../db.js'
import { Errors } from '../../lib/errors.js'
import { getStorageProvider } from '../../providers/storage/index.js'
import * as photoService from './service.js'

export const photosRouter = Router({ mergeParams: true })

const idParams = z.object({ id: objectIdSchema })
const photoParams = z.object({ id: objectIdSchema, photoId: objectIdSchema })

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: DEFAULTS.MAX_PHOTO_UPLOAD_MB * 1024 * 1024,
    files: DEFAULTS.MAX_BATCH_PHOTO_COUNT,
  },
})

photosRouter.post(
  '/',
  requirePermission('photo:upload'),
  validateParams(idParams),
  requireEventAssignment((req) => req.params.id),
  upload.array('photos', DEFAULTS.MAX_BATCH_PHOTO_COUNT),
  asyncHandler(async (req, res) => {
    const files = (req.files as Express.Multer.File[] | undefined) ?? []
    if (files.length === 0) throw Errors.badRequest('No files were uploaded')

    const outcome = await photoService.uploadPhotoBatch(
      req.params.id,
      files.map((f) => ({ buffer: f.buffer, originalFilename: f.originalname, declaredMimeType: f.mimetype })),
      req.user!
    )
    res.status(201).json(outcome)
  })
)

const listQuery = paginationSchema.extend({ status: z.string().optional() })

photosRouter.get(
  '/',
  requirePermission('photo:view'),
  validateParams(idParams),
  validateQuery(listQuery),
  requireEventAssignment((req) => req.params.id),
  asyncHandler(async (req, res) => {
    const { page, pageSize, status } = req.query as unknown as z.infer<typeof listQuery>
    const prisma = getPrisma()
    const where = { eventId: req.params.id, deletedAt: null, ...(status ? { status: status as never } : {}) }
    const [photos, total] = await Promise.all([
      prisma.photo.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      prisma.photo.count({ where }),
    ])
    res.json({ photos, total, page, pageSize })
  })
)

photosRouter.get(
  '/:photoId/preview-url',
  requirePermission('photo:view'),
  validateParams(photoParams),
  requireEventAssignment((req) => req.params.id),
  asyncHandler(async (req, res) => {
    const photo = await getPrisma().photo.findFirst({ where: { id: req.params.photoId, eventId: req.params.id, deletedAt: null } })
    if (!photo) throw Errors.notFound('Photo not found')
    const key = photo.previewKey ?? photo.thumbnailKey
    if (!key) throw Errors.conflict('Photo has not finished processing yet')
    const url = await getStorageProvider().getSignedDownloadUrl(key, DEFAULTS.SIGNED_URL_TTL_MINUTES * 60)
    res.json({ url, expiresInSeconds: DEFAULTS.SIGNED_URL_TTL_MINUTES * 60 })
  })
)

photosRouter.post(
  '/:photoId/retry',
  requirePermission('photo:upload'),
  validateParams(photoParams),
  requireEventAssignment((req) => req.params.id),
  asyncHandler(async (req, res) => {
    await photoService.retryPhotoProcessing(req.params.photoId, req.user!)
    res.json({ success: true })
  })
)

photosRouter.patch(
  '/:photoId/archive',
  requirePermission('photo:delete'),
  validateParams(photoParams),
  validateBody(z.object({ archived: z.boolean() })),
  requireEventAssignment((req) => req.params.id),
  asyncHandler(async (req, res) => {
    await photoService.archivePhoto(req.params.photoId, req.body.archived, req.user!)
    res.json({ success: true })
  })
)

photosRouter.delete(
  '/:photoId',
  requirePermission('photo:delete'),
  validateParams(photoParams),
  requireEventAssignment((req) => req.params.id),
  asyncHandler(async (req, res) => {
    await photoService.deletePhoto(req.params.photoId, req.user!)
    res.json({ success: true })
  })
)
