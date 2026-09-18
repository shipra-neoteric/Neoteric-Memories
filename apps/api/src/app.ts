import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import helmet from 'helmet'
import { env } from './env.js'
import { errorHandler } from './middleware/errorHandler.js'
import { asyncHandler } from './middleware/asyncHandler.js'
import { requireAuth, requireCsrf } from './middleware/auth.js'
import { adminApiLimiter } from './middleware/rateLimit.js'
import { Errors } from './lib/errors.js'
import { runJobsOnce } from './jobs/loop.js'
import { authRouter } from './modules/auth/router.js'
import { sitesRouter } from './modules/sites/router.js'
import { usersRouter } from './modules/users/router.js'
import { eventsRouter } from './modules/events/router.js'
import { photosRouter } from './modules/photos/router.js'
import { consentRouter } from './modules/consent/router.js'
import { retentionRouter } from './modules/retention/router.js'
import { auditRouter } from './modules/audit/router.js'
import { dashboardRouter } from './modules/dashboard/router.js'
import { reportsRouter } from './modules/reports/router.js'
import { guestRouter } from './modules/guest/router.js'
import { filesRouter } from './modules/files/router.js'
import { driveRouter } from './modules/drive/router.js'
import { jobsRouter } from './modules/jobs/router.js'
import { driveCallbackRouter } from './modules/drive/callbackRouter.js'
import { maintenanceRouter } from './modules/maintenance/router.js'

export function createApp() {
  const app = express()

  app.set('trust proxy', 1)
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: false, // the SPA is served separately by Vite/its own static host; the API only returns JSON + signed file bytes.
    })
  )
  // Reflects whatever Origin sent the request rather than a fixed allowlist — this
  // app is meant to be reachable from admin laptops and guest phones on a venue's
  // wifi/cellular under URLs that aren't known ahead of time (LAN IP, ngrok, a
  // custom domain, etc). The actual CSRF defense for admin mutations is the
  // X-CSRF-Token header check (requireCsrf) — an attacker page can trigger a
  // cross-origin request but can never read the CSRF cookie to put its value in
  // that header, so permissive CORS here does not weaken that protection.
  app.use(cors({ origin: true, credentials: true }))
  app.use(express.json({ limit: '2mb' }))
  app.use(cookieParser())

  app.get('/health', (_req, res) => res.json({ status: 'ok', env: env.NODE_ENV }))

  // Drives the same background job queue jobs/loop.ts's startWorkerLoop() polls
  // continuously on a persistent process (Render, local dev) — but a serverless
  // deployment (see api/index.js) has no such process, so an external scheduler
  // hits this route periodically instead (see docs/DEPLOYMENT.md for setup). No
  // admin session involved, so this intentionally sits outside requireAuth/requireCsrf
  // — CRON_SECRET is the only gate, accepted two ways: a `?secret=` query param (the
  // GitHub Actions recovery workflow — see .github/workflows/backend-cron.yml, hits
  // this every 5 minutes as a free backstop since Vercel's own Cron Jobs are capped
  // at once/day on the Hobby plan) or an `Authorization: Bearer` header (Vercel's own
  // native Cron Jobs — see vercel.json's `crons` entry, a once/day retention-focused
  // trigger; Vercel automatically attaches this header using the project's own
  // CRON_SECRET env var, so no secret needs to be embedded in vercel.json itself).
  // Bounded well under this function's configured maxDuration (see vercel.json) so a
  // single invocation can't run past it mid-job — 5s, not closer to the limit,
  // because establishing the MongoDB connection itself (connectDatabase(), called
  // before this route ever runs — see api/index.js) is not part of this budget and
  // can itself take several seconds on a cold serverless start. runJobsOnce() itself
  // recovers any job a previous invocation left stuck RUNNING from exactly this
  // happening.
  app.get(
    '/internal/cron',
    asyncHandler(async (req, res) => {
      const bearerToken = req.header('authorization')?.replace(/^Bearer\s+/i, '')
      const authorized = !!env.CRON_SECRET && (req.query.secret === env.CRON_SECRET || bearerToken === env.CRON_SECRET)
      if (!authorized) throw Errors.unauthorized('Invalid or missing cron secret')
      const summary = await runJobsOnce(5000)
      res.json({ ok: true, ...summary })
    })
  )

  app.use('/files', filesRouter)
  app.use('/api/guest', guestRouter)

  app.use('/api/admin/auth', authRouter)

  const admin = express.Router()
  admin.use(requireAuth, requireCsrf, adminApiLimiter)
  admin.use('/sites', sitesRouter)
  admin.use('/users', usersRouter)
  admin.use('/events', eventsRouter)
  admin.use('/events/:id/photos', photosRouter)
  admin.use('/events/:id/drive', driveRouter)
  admin.use('/events/:id/jobs', jobsRouter)
  admin.use('/integrations/google', driveCallbackRouter)
  admin.use('/consent-versions', consentRouter)
  admin.use('/retention-policies', retentionRouter)
  admin.use('/audit', auditRouter)
  admin.use('/dashboard', dashboardRouter)
  admin.use('/reports', reportsRouter)
  admin.use('/maintenance', maintenanceRouter)
  app.use('/api/admin', admin)

  app.use((req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}` } })
  })
  app.use(errorHandler)

  return app
}
