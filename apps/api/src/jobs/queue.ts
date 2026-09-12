import type { BackgroundJobType } from '@neoteric-memories/shared'
import { getPrisma } from '../db.js'
import { logger } from '../lib/logger.js'
import { toJsonInput } from '../lib/prismaJson.js'

/**
 * Enqueues a background job idempotently: if a job with the same idempotencyKey
 * already exists (queued, running, or already succeeded), this is a silent no-op.
 * Callers should build idempotencyKey from stable business identifiers, e.g.
 * `photo-process:${photoId}` or `zip:${downloadJobId}`, so retried API calls (a
 * flaky upload retry, a duplicate webhook, a re-clicked button) never double-process.
 */
export async function enqueueJob(
  type: BackgroundJobType,
  payload: Record<string, unknown>,
  idempotencyKey: string,
  runAfter?: Date
): Promise<void> {
  try {
    await getPrisma().backgroundJob.create({
      data: { type, payload: toJsonInput(payload), idempotencyKey, runAfter: runAfter ?? new Date() },
    })
  } catch (err) {
    // Prisma throws P2002 on the unique idempotencyKey constraint — that's expected and fine.
    const isDuplicate = typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === 'P2002'
    if (!isDuplicate) {
      logger.error({ type, idempotencyKey }, `Failed to enqueue job: ${String(err)}`)
      throw err
    }
  }
}
