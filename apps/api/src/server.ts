import { env } from './env.js'
import { connectDatabase, disconnectDatabase } from './db.js'
import { createApp } from './app.js'
import { startWorkerLoop, stopWorkerLoop } from './jobs/loop.js'
import { logger } from './lib/logger.js'

const usingEphemeralDb = !env.DATABASE_URL
await connectDatabase()

if (usingEphemeralDb) {
  // Zero-config demo mode: no DATABASE_URL means we just booted a throwaway
  // in-process MongoDB (see db.ts) — auto-seed it so `npm run dev:api` alone is
  // enough to get a fully working, pre-populated demo with zero external services.
  const { runSeed } = await import('../prisma/seedRunner.js')
  await runSeed()
}

const app = createApp()
const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, `Neoteric Memories API listening on port ${env.PORT}`)
})

// A single `npm run dev:api` is enough to see the whole pipeline (upload -> process
// -> index -> search -> zip -> retention) run locally; see jobs/worker.ts for the
// standalone process used to scale this out in production.
startWorkerLoop()

async function shutdown(signal: string) {
  logger.info({ signal }, 'Shutting down...')
  stopWorkerLoop()
  server.close()
  await disconnectDatabase() // also stops the ephemeral mongod child process, if one was started
  process.exit(0)
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
