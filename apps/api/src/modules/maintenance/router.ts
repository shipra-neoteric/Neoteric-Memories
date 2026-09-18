import { Router } from 'express'
import { asyncHandler } from '../../middleware/asyncHandler.js'
import { Errors } from '../../lib/errors.js'
import { getPrisma } from '../../db.js'
import { logger } from '../../lib/logger.js'
import { backfillDeletedPhotoHash } from '../photos/maintenance.js'

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
