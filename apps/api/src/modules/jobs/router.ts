import { Router } from 'express'
import { z } from 'zod'
import { objectIdSchema } from '@neoteric-memories/shared'
import { asyncHandler } from '../../middleware/asyncHandler.js'
import { validateBody, validateParams } from '../../middleware/validate.js'
import { requirePermission, requireEventAssignment } from '../../middleware/rbac.js'
import { claimAndRunScopedJob } from '../../jobs/loop.js'

export const jobsRouter = Router({ mergeParams: true })

const idParams = z.object({ id: objectIdSchema })
const processNextSchema = z.object({ batchId: z.string().optional() })

// Fixed, server-side allowlist — deliberately never accepts a caller-supplied list of
// job types to claim. An admin hitting this route can only ever process THIS event's
// photo-processing jobs (optionally narrowed further to one upload batch), never an
// unrelated event's jobs, another admin's Drive sync, or a system-wide job like
// RETENTION_SWEEP — see claimAndRunScopedJob's own doc comment in jobs/loop.ts for
// why that scoping matters. Drive sync has its own equivalent, self-contained
// immediate-processing wired directly into POST .../drive/sync-now instead of going
// through this route, for the same reason (kept it explicit there too, rather than
// letting a shared "job types" body param decide which permission check applies).
const PHOTO_JOB_TYPES = ['PHOTO_PROCESS', 'PHOTO_HEIC_CONVERT'] as const

/**
 * Claims and runs AT MOST ONE queued photo-processing job (HEIC conversion or face
 * indexing) for this event, optionally narrowed to one upload batch. This is what the
 * manual upload flow (EventDetailPage.tsx's uploadPhotos mutation, after
 * POST .../photos/finalize succeeds) calls in a loop, once per response, until
 * remainingForBatch reaches 0 — the manual-upload equivalent of what a persistent
 * worker process would otherwise do on its own. Concurrent calls (a double-click, two
 * tabs, this loop overlapping with the GitHub Actions recovery cron) never process
 * the same job twice — claiming is the same optimistic
 * status-flip-only-if-still-QUEUED pattern used everywhere else in the job queue.
 */
jobsRouter.post(
  '/process-next',
  requirePermission('photo:upload'),
  validateParams(idParams),
  validateBody(processNextSchema),
  requireEventAssignment((req) => req.params.id),
  asyncHandler(async (req, res) => {
    const outcome = await claimAndRunScopedJob({
      types: [...PHOTO_JOB_TYPES],
      match: req.body.batchId ? { eventId: req.params.id, batchId: req.body.batchId } : { eventId: req.params.id },
    })
    // Deliberately no error message/detail here, even on a failed job — the photo's
    // own processingError (set by the processor, e.g. photoHeicConvert.ts) is the
    // source of truth the client already reads via the polled photos list; this
    // response only needs to say enough to drive the client's claim-loop
    // (keep going / stop / show a generic failure and let the photo grid carry the
    // specific reason).
    res.json({
      processed: outcome.processed,
      jobId: outcome.jobId,
      jobType: outcome.jobType,
      remainingForBatch: outcome.remainingForBatch,
      result: outcome.result,
    })
  })
)
