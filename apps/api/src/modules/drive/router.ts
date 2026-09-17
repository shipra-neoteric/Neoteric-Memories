import crypto from 'node:crypto'
import { Router } from 'express'
import { z } from 'zod'
import { objectIdSchema } from '@neoteric-memories/shared'
import { asyncHandler } from '../../middleware/asyncHandler.js'
import { validateBody, validateParams } from '../../middleware/validate.js'
import { requirePermission } from '../../middleware/rbac.js'
import { getPrisma } from '../../db.js'
import { Errors } from '../../lib/errors.js'
import { enqueueJob } from '../../jobs/queue.js'
import { claimAndRunScopedJob } from '../../jobs/loop.js'
import * as driveService from './service.js'

export const driveRouter = Router({ mergeParams: true })
const idParams = z.object({ id: objectIdSchema })

function toSafeIntegration(i: {
  id: string
  googleAccountEmail: string | null
  folderId: string | null
  folderName: string | null
  status: string
  lastSyncedAt: Date | null
  lastError: string | null
  lastSyncSummary: string | null
  importedCount: number
}) {
  return {
    id: i.id,
    googleAccountEmail: i.googleAccountEmail,
    folderId: i.folderId,
    folderName: i.folderName,
    status: i.status,
    lastSyncedAt: i.lastSyncedAt,
    lastError: i.lastError,
    lastSyncSummary: i.lastSyncSummary,
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
    const eventId = req.params.id
    const integration = await getPrisma().driveIntegration.findUnique({ where: { eventId } })
    if (!integration || !integration.folderId) throw Errors.notFound('No active Drive folder connection for this event')

    // Enqueues, then immediately claims and runs that one job in this same request —
    // this is the "same bounded processing mechanism" the manual upload flow uses
    // (see modules/jobs/router.ts's POST /process-next), applied to Drive sync. A
    // fresh idempotency key every click (not a time-bucketed one) is deliberate: this
    // is a manual admin action, not a scheduled tick, so repeated clicks must each be
    // able to enqueue and run rather than silently no-op against an earlier job's key.
    // MAX_FILES_PER_SYNC_RUN (modules/drive/service.ts) still bounds a single run to a
    // handful of files, so this stays safe well under any reasonable request timeout;
    // a folder with more new files than that shows up in lastSyncSummary ("N more
    // queued") and the client re-clicks — see EventDetailPage.tsx's syncNow mutation.
    await enqueueJob('DRIVE_SYNC', { eventId }, `drive-sync-now:${eventId}:${crypto.randomUUID()}`)
    const outcome = await claimAndRunScopedJob({ types: ['DRIVE_SYNC'], match: { eventId } })

    const fresh = await getPrisma().driveIntegration.findUnique({ where: { eventId } })
    res.json({
      processed: outcome.processed,
      result: outcome.result,
      errorMessage: outcome.errorMessage,
      integration: fresh ? toSafeIntegration(fresh) : null,
    })
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
