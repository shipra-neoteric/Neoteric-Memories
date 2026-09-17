# Job processing on a serverless deployment (no always-on worker required)

The API runs as a Vercel serverless function (`apps/api/api/index.js`). A serverless
function invocation ends shortly after it responds — there is no persistent process to
run `apps/api/src/jobs/loop.ts`'s `setInterval`-based `startWorkerLoop()` the way
Render's (optional — see `DEPLOYMENT.md`) persistent process does. This doc explains how
background jobs (photo processing, HEIC conversion, Drive sync, ZIP generation,
retention) still get processed promptly without one.

## The job queue itself

Unchanged regardless of deployment: `BackgroundJob` documents in MongoDB, claimed via
`claimNextJob()`/`claimAndRunScopedJob()` in `apps/api/src/jobs/loop.ts` using an
optimistic status flip (`QUEUED` → `RUNNING` only succeeds for exactly one caller, even
under concurrent claims — see `claimNextJob`'s `updateMany({ where: { status: 'QUEUED' }
})`). Failed jobs retry with exponential backoff up to `maxAttempts` (default 3), then
land in `FAILED`. A job stuck in `RUNNING` for over two minutes (an invocation that got
killed mid-work) is recovered back to `QUEUED` by `recoverStaleJobs()`.

## Three ways jobs actually get processed

1. **Immediately, triggered by the action that created the work** — the primary
   mechanism for anything a person is actively waiting on:
   - Manual photo upload: after `POST .../photos/finalize` succeeds, the admin page
     calls `POST .../jobs/process-next` (see `apps/api/src/modules/jobs/router.ts`)
     in a sequential loop — one claim per response, never more than one in flight —
     until nothing's left for that upload batch. See
     `EventDetailPage.tsx`'s `drainPhotoJobs`.
   - Drive "Sync Now": `POST .../drive/sync-now` enqueues a `DRIVE_SYNC` job scoped to
     that one event and claims+runs it in the same request/response — see
     `modules/drive/router.ts`. The admin page calls it again automatically while
     `lastSyncSummary` says more files are queued (bounded by `MAX_SYNC_ATTEMPTS`).
   - Guest ZIP download: `POST .../downloads/:downloadJobId/process` — the guest UI
     calls this right after creating the download job (`GuestResults.tsx`), rather
     than waiting on the recovery cron.

   Every one of these uses `claimAndRunScopedJob()` (`jobs/loop.ts`), which only ever
   claims a job whose payload matches an exact scope (an eventId, optionally a
   batchId, or a downloadJobId) — an admin processing their own batch or a guest
   waiting on their own ZIP can never accidentally claim and run someone else's job,
   even though the underlying `BackgroundJob` collection has no other access control
   of its own. Concurrent calls (a double-click, two open tabs) never process the
   same job twice, for the same optimistic-claim reason as the general queue.

2. **Periodic recovery, for anything the above missed** — a closed browser tab
   mid-batch, a page refresh that lost client-side state, a cold-start hiccup.
   `.github/workflows/backend-cron.yml` hits `GET /internal/cron` every 5 minutes,
   which runs `runJobsOnce()` (bounded to a few seconds per call, well under the
   function's configured `maxDuration` — see `vercel.json`). This is a **backstop**,
   not a timing guarantee: GitHub's `schedule` trigger is documented to run
   meaningfully late under platform load. It's free (GitHub Actions minutes are
   unlimited for public repos) and needs no third-party account, which is why it's
   used instead of an external cron service.

   The admin page's own "Resume processing" button (shown whenever the polled photo
   list still has `PENDING`/`PROCESSING` photos with no drain loop currently running)
   covers the same gap client-side, and works correctly after a refresh since it reads
   server state rather than remembering "was I uploading" in any client-side flag.

3. **Once daily, for retention only** — `vercel.json`'s `crons` entry hits the same
   `/internal/cron` route once a day (`0 3 * * *`), authenticated via Vercel's own
   `Authorization: Bearer` mechanism (it automatically attaches the project's
   `CRON_SECRET` env var as a bearer token to its own Cron Job invocations — no secret
   needs to live in `vercel.json` itself). Once/day is the most Vercel's Hobby plan
   allows for its native Cron Jobs, and it's all retention actually needs.
   `requireActiveSession` (`modules/guest/session.ts`) enforces session expiry at
   request time regardless of whether this has run yet, so nothing security-sensitive
   depends on this cron's timing either.

## Known limits, deliberately not fully solved here

- **HEIC conversion** (`jobs/processors/photoHeicConvert.ts`) runs a worker-thread WASM
  decode with its own internal 30s timeout, self-terminating the worker if it runs
  longer — the one genuinely slow, unpredictable step in the whole pipeline. This is
  why `vercel.json` sets `functions.maxDuration: 45` (must stay comfortably above 30s,
  or the function could be killed before that internal timeout even gets a chance to
  fire cleanly). Only one photo's HEIC conversion happens per job/per invocation —
  never several at once — by construction (`claimAndRunScopedJob` claims exactly one
  job).
- **Drive sync** batches at most `MAX_FILES_PER_SYNC_RUN` files per run (lowered from
  30 to 5 when this moved off Render — see `modules/drive/service.ts`'s comment) —
  each file is a real network round trip (Drive download + storage upload), so even a
  moderate file count could otherwise add up to more wall-clock time than one
  invocation should safely spend. A folder with more new files than that takes
  several "Sync Now" clicks (or recovery-cron ticks) to fully drain — this trades
  slower full-backlog draining for per-run safety.
- **ZIP generation** (`jobs/processors/zipGenerate.ts`) is **not** chunked/bounded the
  same way — it still buffers the whole ZIP in memory and loops through every matched
  photo (capped at `DEFAULTS.MAX_RESULTS_PER_SEARCH` = 60) in one job. A guest with a
  large result set could still see this job take long enough to risk the function's
  duration limit. This is a pre-existing gap (flagged in the codebase before this
  change — see `docs/PRODUCTION_READINESS.md`) that this pass did not fix; treat a
  very large per-guest match count as a known risk until `zipGenerate.ts` gets the same
  chunking treatment Drive sync and photo uploads already have.
