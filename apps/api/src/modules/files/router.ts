import { Router, raw } from 'express'
import { z } from 'zod'
import { DEFAULTS } from '@neoteric-memories/shared'
import { asyncHandler } from '../../middleware/asyncHandler.js'
import { Errors } from '../../lib/errors.js'
import { verifySignedKey } from '../../providers/storage/LocalStorageProvider.js'
import { env } from '../../env.js'
import { getStorageProvider } from '../../providers/storage/index.js'

export const filesRouter = Router()

const querySchema = z.object({ exp: z.coerce.number(), sig: z.string(), dl: z.string().optional() })

/**
 * Serves objects for the local (dev/demo) storage provider only — this is what a
 * signed download URL from LocalStorageProvider points at. Never used when
 * STORAGE_PROVIDER=s3, since S3 presigned URLs go straight to AWS.
 */
filesRouter.get(
  '/:key(*)',
  asyncHandler(async (req, res) => {
    if (env.STORAGE_PROVIDER !== 'local') throw Errors.notFound()
    const { exp, sig, dl } = querySchema.parse(req.query)
    const key = req.params.key
    if (!verifySignedKey(key, exp, sig)) throw Errors.forbidden('This link has expired or is invalid.')

    const buffer = await getStorageProvider().getObject(key)
    const contentType = key.endsWith('.png') ? 'image/png' : key.endsWith('.zip') ? 'application/zip' : 'image/jpeg'
    res.setHeader('Content-Type', contentType)
    res.setHeader('Cache-Control', 'private, max-age=60')
    if (dl) res.setHeader('Content-Disposition', `attachment; filename="${dl.replace(/["\\]/g, '')}"`)
    res.send(buffer)
  })
)

const uploadQuerySchema = z.object({ exp: z.coerce.number(), sig: z.string() })

/**
 * The local (dev/demo) storage provider's equivalent of a presigned S3 PUT URL — see
 * LocalStorageProvider.getSignedUploadUrl. Only used when STORAGE_PROVIDER=local; S3
 * presigned URLs go straight to AWS and never touch this API at all, which is the
 * whole point (see modules/photos/router.ts's presign/finalize routes).
 */
filesRouter.put(
  '/upload/:key(*)',
  raw({ type: '*/*', limit: `${DEFAULTS.MAX_PHOTO_UPLOAD_MB}mb` }),
  asyncHandler(async (req, res) => {
    if (env.STORAGE_PROVIDER !== 'local') throw Errors.notFound()
    const { exp, sig } = uploadQuerySchema.parse(req.query)
    const key = req.params.key
    if (!verifySignedKey(key, exp, sig)) throw Errors.forbidden('This link has expired or is invalid.')
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw Errors.badRequest('Request body must be the raw file bytes.')

    const contentType = typeof req.headers['content-type'] === 'string' ? req.headers['content-type'] : 'application/octet-stream'
    await getStorageProvider().putObject({ key, body: req.body, contentType })
    res.status(200).json({ ok: true })
  })
)
