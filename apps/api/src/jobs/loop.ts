import type { BackgroundJobType } from '@neoteric-memories/shared'
import { getPrisma } from '../db.js'
import { env } from '../env.js'
import { logger } from '../lib/logger.js'
import { enqueueJob } from './queue.js'
import { dispatchJob } from './dispatch.js'

const POLL_INTERVAL_MS = 2000
const RETENTION_SWEEP_INTERVAL_MS = 5 * 60 * 1000
const DRIVE_SYNC_INTERVAL_MS = env.DRIVE_SYNC_INTERVAL_MINUTES * 60 * 1000
const BACKOFF_BASE_MS = 3000

// How long a job can sit in RUNNING before we assume whatever claimed it died
// mid-work without updating its status — e.g. a serverless function invocation (see
// runJobsOnce() below) that got killed for running past its execution time limit
// partway through dispatchJob(). claimNextJob() only ever looks at QUEUED jobs, so
// without this a job stuck in RUNNING would stay stuck forever.
const STALE_RUNNING_THRESHOLD_MS = 2 * 60 * 1000

let loopHandle: ReturnType<typeof setInterval> | undefined
let retentionHandle: ReturnType<typeof setInterval> | undefined
let driveSyncHandle: ReturnType<typeof setInterval> | undefined

/**
 * Resets any job stuck in RUNNING past STALE_RUNNING_THRESHOLD_MS back to QUEUED
 * (incrementing attempts, same as a normal failure) so it gets picked up again
 * instead of sitting abandoned forever. See the threshold's own doc comment for why
 * this matters specifically for runJobsOnce()'s serverless callers.
 */
export async function recoverStaleJobs(): Promise<void> {
  const prisma = getPrisma()
  const stale = await prisma.backgroundJob.findMany({
    where: { status: 'RUNNING', updatedAt: { lt: new Date(Date.now() - STALE_RUNNING_THRESHOLD_MS) } },
  })
  for (const job of stale) {
    const attempts = job.attempts
    if (attempts >= job.maxAttempts) {
      logger.error({ jobId: job.id, type: job.type, attempts }, 'Job permanently failed: stuck in RUNNING past the stale threshold')
      await prisma.backgroundJob.update({ where: { id: job.id }, data: { status: 'FAILED', lastError: 'Stuck in RUNNING past the stale threshold (invocation likely killed mid-work)' } })
    } else {
      logger.warn({ jobId: job.id, type: job.type, attempts }, 'Recovering job stuck in RUNNING past the stale threshold — requeuing')
      await prisma.backgroundJob.update({ where: { id: job.id }, data: { status: 'QUEUED', runAfter: new Date() } })
    }
  }
}

/**
 * Enqueues RETENTION_SWEEP/DRIVE_SYNC if their interval's current "bucket" hasn't
 * already been enqueued — the exact same idempotency scheme startWorkerLoop()'s
 * setInterval timers use (see enqueueJob's dedup-by-idempotencyKey doc comment),
 * just evaluated once per call instead of on its own timer. Safe to call as often as
 * runJobsOnce() itself gets invoked; it only actually enqueues once per interval.
 */
async function enqueueDueScheduledJobs(): Promise<void> {
  const retentionBucket = Math.floor(Date.now() / RETENTION_SWEEP_INTERVAL_MS)
  await enqueueJob('RETENTION_SWEEP', {}, `retention-sweep:${retentionBucket}`).catch((err) =>
    logger.error({}, `Failed to enqueue retention sweep: ${String(err)}`)
  )
  const driveSyncBucket = Math.floor(Date.now() / DRIVE_SYNC_INTERVAL_MS)
  await enqueueJob('DRIVE_SYNC', {}, `drive-sync:${driveSyncBucket}`).catch((err) =>
    logger.error({}, `Failed to enqueue drive sync: ${String(err)}`)
  )
}

/**
 * One bounded pass through the job queue for callers with no persistent process to
 * poll it continuously — specifically GET /internal/cron (see app.ts), hit by an
 * external scheduler on a serverless deployment (api/index.js) that has no
 * setInterval-based startWorkerLoop() of its own. Claims and processes jobs
 * one at a time until either the queue is empty or budgetMs has elapsed, leaving
 * enough headroom for the caller's own function execution limit to not get hit
 * mid-job.
 */
export async function runJobsOnce(budgetMs: number): Promise<{ processed: number; elapsedMs: number }> {
  const start = Date.now()
  await recoverStaleJobs()
  await enqueueDueScheduledJobs()

  let processed = 0
  while (Date.now() - start < budgetMs) {
    const didWork = await claimNextJob()
    if (!didWork) break
    processed += 1
  }
  return { processed, elapsedMs: Date.now() - start }
}

interface RunOutcome {
  outcome: 'succeeded' | 'failed' | 'retrying'
  errorMessage?: string
}

/** Runs an already-claimed (status RUNNING) job to completion, applying the same success/retry/permanent-failure bookkeeping regardless of how it was claimed (the global sweep or a scoped admin-triggered claim). */
async function runClaimedJob(candidate: { id: string; type: BackgroundJobType; payload: unknown; attempts: number; maxAttempts: number }): Promise<RunOutcome> {
  const prisma = getPrisma()
  logger.info({ jobId: candidate.id, type: candidate.type, payload: candidate.payload }, 'Claimed job')
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await dispatchJob(candidate.type, candidate.payload as any)
    await prisma.backgroundJob.update({ where: { id: candidate.id }, data: { status: 'SUCCEEDED' } })
    return { outcome: 'succeeded' }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const fresh = await prisma.backgroundJob.findUnique({ where: { id: candidate.id } })
    const attempts = fresh?.attempts ?? candidate.attempts + 1
    const maxAttempts = fresh?.maxAttempts ?? candidate.maxAttempts
    if (attempts >= maxAttempts) {
      logger.error({ jobId: candidate.id, type: candidate.type, attempts }, `Job permanently failed: ${message}`)
      await prisma.backgroundJob.update({ where: { id: candidate.id }, data: { status: 'FAILED', lastError: message } })
      return { outcome: 'failed', errorMessage: message }
    }
    const backoff = BACKOFF_BASE_MS * 2 ** (attempts - 1)
    logger.warn({ jobId: candidate.id, type: candidate.type, attempts, backoff }, `Job failed, will retry: ${message}`)
    await prisma.backgroundJob.update({
      where: { id: candidate.id },
      data: { status: 'QUEUED', lastError: message, runAfter: new Date(Date.now() + backoff) },
    })
    return { outcome: 'retrying', errorMessage: message }
  }
}

export async function claimNextJob(): Promise<boolean> {
  const prisma = getPrisma()
  const candidate = await prisma.backgroundJob.findFirst({
    where: { status: 'QUEUED', runAfter: { lte: new Date() } },
    orderBy: { runAfter: 'asc' },
  })
  if (!candidate) return false

  // Optimistic claim: only proceed if we're the one who flipped it from QUEUED to RUNNING.
  const claimed = await prisma.backgroundJob.updateMany({
    where: { id: candidate.id, status: 'QUEUED' },
    data: { status: 'RUNNING', attempts: { increment: 1 } },
  })
  if (claimed.count !== 1) return false

  await runClaimedJob(candidate)
  return true
}

// How many QUEUED candidates a scoped claim is willing to scan (oldest-first) looking
// for one matching the requested scope, before giving up. Payload is untyped JSON —
// filtering by eventId/batchId happens in application code rather than a DB-level JSON
// query, since Prisma's JSON filtering support varies by connector and this avoids
// depending on it. Bounded so a huge unrelated backlog can't make a scoped claim scan
// unboundedly; a caller whose job hasn't been reached within this window will see
// nothing to claim yet and can just ask again shortly.
const SCOPED_CLAIM_SCAN_LIMIT = 100

export interface ScopedClaimFilter {
  types: BackgroundJobType[]
  // Every key here must match exactly in a candidate job's payload for it to be
  // eligible — e.g. { eventId } for "any photo job for this event", { eventId,
  // batchId } for "just this upload batch", or { downloadJobId } for a guest's own
  // ZIP job. Whatever fields aren't relevant to a given job type just won't be
  // present in its payload and therefore never match a filter that includes them,
  // which is exactly the desired behavior (never cross-match unrelated job shapes).
  match: Record<string, string>
}

export interface ScopedJobResult {
  processed: boolean
  jobId?: string
  jobType?: BackgroundJobType
  result: 'completed' | 'failed' | 'nothing_to_process'
  errorMessage?: string
  remainingForBatch: number
}

function payloadMatchesScope(payload: unknown, filter: ScopedClaimFilter): boolean {
  if (typeof payload !== 'object' || payload === null) return false
  const p = payload as Record<string, unknown>
  return Object.entries(filter.match).every(([key, value]) => p[key] === value)
}

/**
 * Claims and runs AT MOST ONE job matching the given scope (job type(s) + exact
 * payload field matches) — the primitive behind POST /api/admin/jobs/process-next
 * (see modules/jobs/router.ts), the Drive "Sync Now" flow, and a guest's own ZIP
 * download trigger. Scoping is deliberate: an admin processing their own upload batch
 * or Drive sync, or a guest waiting on their own ZIP, must never accidentally claim
 * and run an unrelated job (another event's photos, a system-wide RETENTION_SWEEP,
 * another admin's Drive sync, another guest's download) just because it happened to
 * be next in the global queue. Concurrent calls (e.g. a double-click, or two browser
 * tabs) never process the same job twice — claiming uses the same optimistic
 * status-flip-if-still-QUEUED pattern as claimNextJob().
 */
export async function claimAndRunScopedJob(filter: ScopedClaimFilter): Promise<ScopedJobResult> {
  const prisma = getPrisma()
  const candidates = await prisma.backgroundJob.findMany({
    where: { status: 'QUEUED', runAfter: { lte: new Date() }, type: { in: filter.types } },
    orderBy: { runAfter: 'asc' },
    take: SCOPED_CLAIM_SCAN_LIMIT,
  })

  let claimedJob: (typeof candidates)[number] | undefined
  for (const candidate of candidates) {
    if (!payloadMatchesScope(candidate.payload, filter)) continue
    const claimed = await prisma.backgroundJob.updateMany({
      where: { id: candidate.id, status: 'QUEUED' },
      data: { status: 'RUNNING', attempts: { increment: 1 } },
    })
    if (claimed.count === 1) {
      claimedJob = candidate
      break
    }
    // Someone else (another request, another tab) claimed it first — keep scanning.
  }

  const countRemaining = async () => {
    const remaining = await prisma.backgroundJob.findMany({
      where: { status: { in: ['QUEUED', 'RUNNING'] }, type: { in: filter.types } },
      select: { payload: true },
      take: SCOPED_CLAIM_SCAN_LIMIT,
    })
    return remaining.filter((r) => payloadMatchesScope(r.payload, filter)).length
  }

  if (!claimedJob) {
    return { processed: false, result: 'nothing_to_process', remainingForBatch: await countRemaining() }
  }

  const run = await runClaimedJob(claimedJob)
  const remainingForBatch = await countRemaining()
  return {
    processed: true,
    jobId: claimedJob.id,
    jobType: claimedJob.type,
    result: run.outcome === 'succeeded' ? 'completed' : 'failed',
    errorMessage: run.errorMessage,
    remainingForBatch,
  }
}

export function startWorkerLoop(): void {
  if (loopHandle) return
  loopHandle = setInterval(() => {
    claimNextJob().catch((err) => logger.error({}, `Worker loop error: ${String(err)}`))
  }, POLL_INTERVAL_MS)

  retentionHandle = setInterval(() => {
    const bucket = Math.floor(Date.now() / RETENTION_SWEEP_INTERVAL_MS)
    enqueueJob('RETENTION_SWEEP', {}, `retention-sweep:${bucket}`).catch((err) =>
      logger.error({}, `Failed to enqueue retention sweep: ${String(err)}`)
    )
  }, RETENTION_SWEEP_INTERVAL_MS)

  driveSyncHandle = setInterval(() => {
    const bucket = Math.floor(Date.now() / DRIVE_SYNC_INTERVAL_MS)
    enqueueJob('DRIVE_SYNC', {}, `drive-sync:${bucket}`).catch((err) => logger.error({}, `Failed to enqueue drive sync: ${String(err)}`))
  }, DRIVE_SYNC_INTERVAL_MS)

  logger.info({ pollIntervalMs: POLL_INTERVAL_MS, driveSyncIntervalMinutes: env.DRIVE_SYNC_INTERVAL_MINUTES }, 'Background worker loop started')
}

export function stopWorkerLoop(): void {
  if (loopHandle) clearInterval(loopHandle)
  if (retentionHandle) clearInterval(retentionHandle)
  if (driveSyncHandle) clearInterval(driveSyncHandle)
  loopHandle = undefined
  retentionHandle = undefined
  driveSyncHandle = undefined
}
