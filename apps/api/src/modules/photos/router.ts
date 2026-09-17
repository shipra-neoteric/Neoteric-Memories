import os from 'node:os'
import crypto from 'node:crypto'
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

// Streams straight to a temp file per upload instead of buffering every file in a
// large batch in RAM simultaneously (multer.memoryStorage() would hold the whole
// batch in memory at once — for a big enough batch on a memory-constrained instance
// that's enough to crash/restart the process partway through, silently leaving only
// however many files had already made it into the DB by that point, with no error
// ever surfacing to the client). service.ts's uploadPhotoBatch reads each file's
// bytes from disk one at a time and deletes the temp file once it's done with it.
const upload = multer({
  storage: multer.diskStorage({
    destination: os.tmpdir(),
    filename: (_req, _file, cb) => cb(null, `nm-upload-${crypto.randomUUID()}`),
  }),
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

    const eventId = req.params.id
    const inputs = files.map((f) => ({ filePath: f.path, originalFilename: f.originalname, declaredMimeType: f.mimetype }))

    // Both halves are awaited here and stay fast even for a large batch: classifying
    // is just a disk-read-and-hash pass, and processing uploads each accepted file's
    // bytes as-is without ever doing the slow HEIC->JPEG decode inline (see
    // processAcceptedFiles's own doc comment) — that decode is deferred to a queued
    // PHOTO_HEIC_CONVERT job instead, which is what actually fixed this route timing
    // out on batches with several HEIC files (see the "manual upload timing out"
    // incident). The event page's photos list already polls on an interval and shows
    // each photo's real-time status as it's processed.
    const classified = await photoService.classifyUploadBatch(eventId, inputs)
    const processed =
      classified.accepted.length > 0
        ? await photoService.processAcceptedFiles(eventId, classified.accepted, req.user!)
        : { accepted: [], failed: [], batchId: null }

    res.status(201).json({
      accepted: processed.accepted,
      duplicates: classified.duplicates,
      rejected: [...classified.rejected, ...processed.failed],
      batchId: processed.batchId,
    })
  })
)

const presignSchema = z.object({
  files: z
    .array(z.object({ filename: z.string().min(1), contentType: z.string().min(1) }))
    .min(1)
    .max(DEFAULTS.MAX_BATCH_PHOTO_COUNT),
})

// Vercel hard-rejects any request body over ~4.5MB regardless of our own code — real
// phone photos routinely exceed that alone, let alone a batch of them in one
// multipart request (see the "413 FUNCTION_PAYLOAD_TOO_LARGE" incident). These two
// routes are what let the browser upload directly to storage instead: presign hands
// back one signed PUT URL per file (this request/response is tiny — just filenames),
// the browser PUTs each file straight to storage itself (bypassing this API
// entirely), then finalize (small JSON, no file bytes either) tells the API which
// storage keys are ready so it can validate/dedupe/create the actual Photo rows.
photosRouter.post(
  '/presign',
  requirePermission('photo:upload'),
  validateParams(idParams),
  validateBody(presignSchema),
  requireEventAssignment((req) => req.params.id),
  asyncHandler(async (req, res) => {
    const presigned = await photoService.presignUploads(req.params.id, req.body.files)
    res.json({ files: presigned })
  })
)

const finalizeSchema = z.object({
  files: z
    .array(z.object({ key: z.string().min(1), photoId: z.string().min(1), filename: z.string().min(1) }))
    .min(1)
    .max(DEFAULTS.MAX_BATCH_PHOTO_COUNT),
})

photosRouter.post(
  '/finalize',
  requirePermission('photo:upload'),
  validateParams(idParams),
  validateBody(finalizeSchema),
  requireEventAssignment((req) => req.params.id),
  asyncHandler(async (req, res) => {
    const eventId = req.params.id
    const inputs = (req.body.files as { key: string; photoId: string; filename: string }[]).map((f) => ({
      storageKey: f.key,
      photoId: f.photoId,
      originalFilename: f.filename,
      declaredMimeType: 'application/octet-stream',
    }))

    const classified = await photoService.classifyUploadBatch(eventId, inputs)
    const processed =
      classified.accepted.length > 0
        ? await photoService.processAcceptedFiles(eventId, classified.accepted, req.user!)
        : { accepted: [], failed: [], batchId: null }

    res.status(201).json({
      accepted: processed.accepted,
      duplicates: classified.duplicates,
      rejected: [...classified.rejected, ...processed.failed],
      batchId: processed.batchId,
    })
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
