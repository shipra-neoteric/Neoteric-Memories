// CLI entrypoint (`npm run seed`). If DATABASE_URL is unset this boots its own
// throwaway ephemeral MongoDB, seeds it, then tears it down — useful as a quick
// smoke test, but it will NOT be the same database your `npm run dev:api` is using
// (that server seeds itself automatically on boot in ephemeral mode — see
// server.ts). Set DATABASE_URL to point both at the same real MongoDB/Atlas
// instance if you want this command to populate the database your dev server reads.
import { connectDatabase, disconnectDatabase } from '../src/db.js'
import { logger } from '../src/lib/logger.js'
import { runSeed } from './seedRunner.js'

await connectDatabase()
try {
  await runSeed()
} catch (err) {
  logger.error({}, `Seed failed: ${err instanceof Error ? err.stack : String(err)}`)
  process.exitCode = 1
} finally {
  await disconnectDatabase()
}
