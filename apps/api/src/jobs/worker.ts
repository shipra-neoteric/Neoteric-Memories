// Standalone worker entrypoint (`npm run worker`) — for scaling job processing as a
// separate process/container in production. In local dev the API server also starts
// this loop embedded in-process (see server.ts) so a single `npm run dev:api` is
// enough to see the whole pipeline run.
import { connectDatabase } from '../db.js'
import { logger } from '../lib/logger.js'
import { startWorkerLoop } from './loop.js'

await connectDatabase()
startWorkerLoop()
logger.info({}, 'Standalone worker process running')
