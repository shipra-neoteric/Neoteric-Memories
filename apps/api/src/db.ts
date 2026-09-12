import { env } from './env.js'
import { logger } from './lib/logger.js'
import { isTestRuntime } from './lib/testGuard.js'
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import type { PrismaClient as PrismaClientType } from '../prisma/generated/client/index.js'

let prismaSingleton: PrismaClientType | undefined
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let memoryServerHandle: any

/**
 * Must be called once, and awaited, before any code touches getPrisma().
 * If DATABASE_URL is unset, boots an ephemeral in-process MongoDB (mongodb-memory-server)
 * so the app runs with zero external dependencies — this is what makes "mock mode works
 * without paid services" true for the whole stack, not just the face provider.
 */
export async function connectDatabase(): Promise<PrismaClientType> {
  if (prismaSingleton) return prismaSingleton

  // Hard safety net, independent of env.ts's own forcing (belt and suspenders —
  // this is what actually stopped the incident from being worse than it was,
  // since env.ts's forcing did not exist yet at the time). Under the Vitest
  // runtime, DATABASE_URL is never even read — always boot the ephemeral
  // MongoMemoryReplSet. See src/lib/testGuard.ts for why this check is safe from
  // the same class of bug that caused the incident.
  let url = isTestRuntime() ? '' : env.DATABASE_URL
  if (!url) {
    // Prisma's mongodb connector requires a replica set (even a single-node one) to
    // support transactions. MongoMemoryReplSet — not MongoMemoryServer's `replSet`
    // instance option — is the reliable way to get one that actually reaches PRIMARY
    // before we hand back a connection string (a plain MongoMemoryServer with a
    // replSet name left the node stuck in RSGHOST state and every query timed out).
    const { MongoMemoryReplSet } = await import('mongodb-memory-server')
    memoryServerHandle = await MongoMemoryReplSet.create({
      replSet: { count: 1, dbName: 'neoteric_memories', storageEngine: 'wiredTiger' },
    })
    await memoryServerHandle.waitUntilRunning()
    url = memoryServerHandle.getUri('neoteric_memories')
    logger.warn(
      { source: 'db' },
      'DATABASE_URL not set — booted an ephemeral in-process MongoDB via mongodb-memory-server. Data will NOT persist across restarts. Set DATABASE_URL to a MongoDB Atlas connection string for real usage.'
    )
  }
  process.env.DATABASE_URL = url

  const { PrismaClient } = await import('../prisma/generated/client/index.js')
  prismaSingleton = new PrismaClient({
    log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  })
  await prismaSingleton.$connect()
  return prismaSingleton
}

export function getPrisma(): PrismaClientType {
  if (!prismaSingleton) {
    throw new Error('Database not connected yet — connectDatabase() must be awaited at startup before getPrisma() is used.')
  }
  return prismaSingleton
}

export async function disconnectDatabase(): Promise<void> {
  if (prismaSingleton) {
    await prismaSingleton.$disconnect()
    prismaSingleton = undefined
  }
  if (memoryServerHandle) {
    await memoryServerHandle.stop()
    memoryServerHandle = undefined
  }
}
