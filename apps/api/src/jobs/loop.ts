import { getPrisma } from '../db.js'
import { env } from '../env.js'
import { logger } from '../lib/logger.js'
import { enqueueJob } from './queue.js'
import { dispatchJob } from './dispatch.js'

const POLL_INTERVAL_MS = 2000
const RETENTION_SWEEP_INTERVAL_MS = 5 * 60 * 1000
const DRIVE_SYNC_INTERVAL_MS = env.DRIVE_SYNC_INTERVAL_MINUTES * 60 * 1000
const BACKOFF_BASE_MS = 3000

let loopHandle: ReturnType<typeof setInterval> | undefined
let retentionHandle: ReturnType<typeof setInterval> | undefined
let driveSyncHandle: ReturnType<typeof setInterval> | undefined

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

  try {
    await dispatchJob(candidate.type, candidate.payload)
    await prisma.backgroundJob.update({ where: { id: candidate.id }, data: { status: 'SUCCEEDED' } })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const fresh = await prisma.backgroundJob.findUnique({ where: { id: candidate.id } })
    const attempts = fresh?.attempts ?? candidate.attempts + 1
    const maxAttempts = fresh?.maxAttempts ?? candidate.maxAttempts
    if (attempts >= maxAttempts) {
      logger.error({ jobId: candidate.id, type: candidate.type, attempts }, `Job permanently failed: ${message}`)
      await prisma.backgroundJob.update({ where: { id: candidate.id }, data: { status: 'FAILED', lastError: message } })
    } else {
      const backoff = BACKOFF_BASE_MS * 2 ** (attempts - 1)
      logger.warn({ jobId: candidate.id, type: candidate.type, attempts, backoff }, `Job failed, will retry: ${message}`)
      await prisma.backgroundJob.update({
        where: { id: candidate.id },
        data: { status: 'QUEUED', lastError: message, runAfter: new Date(Date.now() + backoff) },
      })
    }
  }
  return true
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
