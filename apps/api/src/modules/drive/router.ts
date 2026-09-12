import { Router } from 'express'
import { z } from 'zod'
import { objectIdSchema } from '@neoteric-memories/shared'
import { asyncHandler } from '../../middleware/asyncHandler.js'
import { validateBody, validateParams } from '../../middleware/validate.js'
import { requirePermission } from '../../middleware/rbac.js'
import { getPrisma } from '../../db.js'
import { Errors } from '../../lib/errors.js'
import * as driveService from './service.js'
import { syncOneIntegration } from './service.js'

export const driveRouter = Router({ mergeParams: true })
const idParams = z.object({ id: objectIdSchema })

function toSafeIntegration(i: { id: string; googleAccountEmail: string | null; folderId: string | null; folderName: string | null; status: string; lastSyncedAt: Date | null; lastError: string | null; importedCount: number }) {
  return {
    id: i.id,
    googleAccountEmail: i.googleAccountEmail,
    folderId: i.folderId,
    folderName: i.folderName,
    status: i.status,
    lastSyncedAt: i.lastSyncedAt,
    lastError: i.lastError,
    importedCount: i.importedCount,
  }
}

driveRouter.get(
  '/',
  requirePermission('event:manage_integrations'),
  validateParams(idParams),
  asyncHandler(async (req, res) => {
    const integration = await getPrisma().driveIntegration.findUnique({ where: { eventId: req.params.id } })
    res.json({ enabled: driveService.isDriveIntegrationConfigured(), integration: integration ? toSafeIntegration(integration) : null })
  })
)

driveRouter.get(
  '/connect',
  requirePermission('event:manage_integrations'),
  validateParams(idParams),
  asyncHandler(async (req, res) => {
    if (!driveService.isDriveIntegrationConfigured()) throw Errors.conflict('Google Drive integration is not configured on this server')
    const url = await driveService.startConnect(req.params.id, req.user!)
    res.json({ url })
  })
)

driveRouter.post(
  '/folder',
  requirePermission('event:manage_integrations'),
  validateParams(idParams),
  validateBody(z.object({ folder: z.string().min(3) })),
  asyncHandler(async (req, res) => {
    const integration = await driveService.setFolder(req.params.id, req.body.folder, req.user!)
    res.json({ integration: toSafeIntegration(integration) })
  })
)

driveRouter.post(
  '/sync-now',
  requirePermission('event:manage_integrations'),
  validateParams(idParams),
  asyncHandler(async (req, res) => {
    const integration = await getPrisma().driveIntegration.findUnique({ where: { eventId: req.params.id } })
    if (!integration || !integration.folderId) throw Errors.notFound('No active Drive folder connection for this event')
    const result = await syncOneIntegration(integration)
    res.json(result)
  })
)

driveRouter.post(
  '/pause',
  requirePermission('event:manage_integrations'),
  validateParams(idParams),
  asyncHandler(async (req, res) => {
    const integration = await driveService.pauseOrResume(req.params.id, false, req.user!)
    res.json({ integration: toSafeIntegration(integration) })
  })
)

driveRouter.post(
  '/resume',
  requirePermission('event:manage_integrations'),
  validateParams(idParams),
  asyncHandler(async (req, res) => {
    const integration = await driveService.pauseOrResume(req.params.id, true, req.user!)
    res.json({ integration: toSafeIntegration(integration) })
  })
)

driveRouter.delete(
  '/',
  requirePermission('event:manage_integrations'),
  validateParams(idParams),
  asyncHandler(async (req, res) => {
    await driveService.disconnect(req.params.id, req.user!)
    res.json({ success: true })
  })
)
