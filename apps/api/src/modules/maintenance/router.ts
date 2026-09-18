import { Router } from 'express'
import { z } from 'zod'
import { objectIdSchema } from '@neoteric-memories/shared'
import { asyncHandler } from '../../middleware/asyncHandler.js'
import { validateBody } from '../../middleware/validate.js'
import { Errors } from '../../lib/errors.js'
import { getPrisma } from '../../db.js'
import { logger } from '../../lib/logger.js'
import { backfillDeletedPhotoHash } from '../photos/maintenance.js'
import { hardDeleteAllPhotosForEvent } from '../photos/service.js'

export const maintenanceRouter = Router()

// MASTER_ADMIN-only, same bypass pattern as modules/sites/router.ts — this touches
// every event's Photo rows at once, not just ones the caller is assigned to, so the
// normal per-event requireEventAssignment scoping doesn't apply here.
maintenanceRouter.post(
  '/backfill-deleted-photo-hash',
  asyncHandler(async (req, res) => {
    if (req.user!.role !== 'MASTER_ADMIN') throw Errors.forbidden()
    const result = await backfillDeletedPhotoHash(getPrisma())
    logger.info(result, 'Backfilled legacy Photo deletedAt/fileHash rows via admin maintenance route')
    res.json(result)
  })
)

const hardDeleteSchema = z.object({ eventId: objectIdSchema, confirm: z.literal(true) })

// Irreversible — see hardDeleteAllPhotosForEvent's own doc comment. `confirm: true`
// is required in the body (not just the eventId) so this can never be triggered by,
// e.g., a request replayed without its original intent behind it.
maintenanceRouter.post(
  '/hard-delete-event-photos',
  validateBody(hardDeleteSchema),
  asyncHandler(async (req, res) => {
    if (req.user!.role !== 'MASTER_ADMIN') throw Errors.forbidden()
    const { eventId } = req.body as z.infer<typeof hardDeleteSchema>
    const result = await hardDeleteAllPhotosForEvent(eventId, req.user!)
    logger.info({ eventId, ...result }, 'Hard-deleted all photos for event via admin maintenance route')
    res.json(result)
  })
)
