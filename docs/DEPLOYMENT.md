# Deployment — Vercel (frontend + API) + MongoDB Atlas + AWS S3

## Current architecture: fully free/serverless, Render is optional

As of this section being written, the live deployment runs **entirely on free tiers with
no always-on paid service required**: both the frontend and the API are Vercel
serverless functions (`apps/web` static build + `apps/api/api/index.js`), the database
is MongoDB Atlas's free M0 tier, and file storage is AWS S3. Background job processing
(photo/HEIC processing, Drive sync, ZIP generation, retention) does **not** need a
persistent worker process — see `docs/JOB_PROCESSING.md` for exactly how that works.
Render's role is now **optional**, not required:

- **Manual uploads** process immediately: `POST .../photos/finalize` is followed by the
  admin page calling `POST .../jobs/process-next` in a loop until the batch is done —
  see `apps/web/src/pages/admin/EventDetailPage.tsx`'s `drainPhotoJobs`.
- **"Sync Now"** (Drive) and a guest's ZIP download button trigger their own job
  immediately the same way — no polling wait needed for an admin-/guest-initiated
  action.
- **Delayed/interrupted jobs** (a closed browser tab mid-batch, a Vercel cold-start
  hiccup) are recovered by a free GitHub Actions workflow
  (`.github/workflows/backend-cron.yml`) hitting `GET /internal/cron` every 5 minutes —
  this is a backstop, not a promise of prompt timing (GitHub's schedule trigger can run
  meaningfully late under platform load).
- **Retention cleanup** runs once daily via Vercel's own native Cron Jobs (`vercel.json`'s
  `crons` entry — the Hobby plan allows exactly this, once/day, which is all retention
  needs) — no external scheduler required for that piece.
- **Session/access-window expiry** is enforced at request time regardless of whether any
  cleanup job has run yet (see `apps/api/src/modules/guest/session.ts`'s
  `requireActiveSession`) — an expired guest session is rejected immediately, it never
  depends on the retention sweep's timing.

**If you still want Render** (e.g. you'd rather have near-instant job processing via a
persistent worker instead of the process-next/recovery-cron combination above), the
sections below still work — `render.yaml` now deploys a **worker-only** service
(`node apps/api/dist/jobs/worker.js`), since the HTTP API itself moved to Vercel. Running
both at once is safe (the job queue's optimistic claiming means Render and Vercel's own
triggers never double-process the same job) and is a reasonable way to verify the new
setup actually works before deciding whether to keep Render at all.

**Before suspending/deleting the Render service**: verify, against your real production
data, that (1) a manual photo upload finishes processing without you doing anything else,
(2) "Sync Now" completes and imports photos, (3) a guest selfie search + ZIP download
works end to end, (4) the GitHub Actions workflow's last run succeeded (Actions tab), and
(5) the daily retention cron has run at least once (Vercel dashboard → your backend
project → Cron Jobs) or `POST /api/admin/retention-policies/run-now` works manually.
Nothing in this repository suspends or deletes the Render service automatically — that's
a manual step you take once you're confident, not something any script here will do for
you.

---

This is the original path chosen for Neoteric Memories: static frontend on Vercel, API + worker on Render as one service, database on MongoDB Atlas. All three have a free/low-cost tier sufficient for a pilot event. Kept below as a still-valid option — see the section above for the current default (no Render needed at all).

**Config files already in the repo**: `render.yaml` (Render Blueprint, now worker-only), `vercel.json` (build + SPA routing + the API's own serverless function config). You mostly need to create accounts and paste in values — not write config.

## 1. MongoDB Atlas (do this first — everything else needs the connection string)

1. [cloud.mongodb.com](https://cloud.mongodb.com) → create a free account → create a project → **Build a Database** → **M0 Free** tier → pick a region close to where Render will run.
2. **Database Access** → add a database user (username/password, "Read and write to any database").
3. **Network Access** → **Add IP Address** → **Allow Access from Anywhere** (`0.0.0.0/0`). Render's free/starter tiers don't have a fixed outbound IP, so this is the practical choice for a pilot; tighten it later if you upgrade to a plan with static IPs.
4. **Connect → Drivers** → copy the connection string, looks like:
   `mongodb+srv://<user>:<password>@<cluster>.mongodb.net/?retryWrites=true&w=majority`
   Add a database name before the `?`: `.../neoteric_memories?retryWrites=true&w=majority`. This full string is your `DATABASE_URL`.

## 2. Backend — Render

1. Push this repo to a GitHub/GitLab repo (Render deploys from a git repo).
2. [dashboard.render.com](https://dashboard.render.com) → **New → Blueprint** → connect the repo → Render reads `render.yaml` automatically and shows the one `neoteric-memories-api` service with its env vars.
3. Fill in the `sync: false` values it prompts for:
   - `APP_BASE_URL` — leave blank for now, come back after step 3 (Vercel) gives you the URL.
   - `API_BASE_URL` — Render shows you this service's URL before first deploy (`https://neoteric-memories-api.onrender.com` or similar) — enter that.
   - `DATABASE_URL` — the Atlas string from step 1.
   - `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` — see [AWS_DEPLOYMENT.md](AWS_DEPLOYMENT.md). **Do not leave `STORAGE_PROVIDER=local` in production** — Render's filesystem is ephemeral and wiped on every deploy/restart, so local storage would silently lose every uploaded photo.
   - `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` — same AWS account as S3; leave `FACE_PROVIDER=mock` until these are ready, see [AWS_DEPLOYMENT.md](AWS_DEPLOYMENT.md).
   - `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_OAUTH_REDIRECT_URI` — optional, see [GOOGLE_DRIVE.md](GOOGLE_DRIVE.md). Leave blank to skip Drive sync for now.
   - `JWT_SECRET`/`COOKIE_SECRET` are auto-generated by Render (`generateValue: true`) — nothing to do.
4. Deploy. Watch the logs; first boot runs `prisma generate` then starts the server. Confirm `GET https://<your-service>.onrender.com/health` returns `{"status":"ok"}`.
5. **Create your first real admin user.** A fresh Atlas database has no users at all, so there's nothing to log in with yet. Don't run `npm run seed` against it — that script creates the fake demo sites/events (Ganesh Chaturthi, etc.) meant for local testing only. Instead run the production-safe bootstrap script once, from your own machine, pointed at the real `DATABASE_URL`:
   ```bash
   cd apps/api
   BOOTSTRAP_ADMIN_EMAIL="you@company.com" BOOTSTRAP_ADMIN_NAME="Your Name" DATABASE_URL="<your atlas connection string>" npx tsx prisma/bootstrapAdmin.ts
   ```
   (PowerShell: `$env:BOOTSTRAP_ADMIN_EMAIL="you@company.com"; $env:DATABASE_URL="..."; npx tsx prisma/bootstrapAdmin.ts`.) It prints a one-time temporary password — log in immediately and change it via **Users → (your account)**. It also creates a default draft consent version and retention policy so you can create your first real site/event straight away; it never creates fake data.

## 3. Frontend — Vercel

1. [vercel.com](https://vercel.com) → **Add New → Project** → import the same repo.
2. Vercel should auto-detect `vercel.json` at the repo root (Root Directory = repo root, don't change it to `apps/web`; the build command in `vercel.json` handles the monorepo build itself).
3. **Environment Variables** → add:
   - `VITE_API_BASE_URL` = your Render URL from step 2 (e.g. `https://neoteric-memories-api.onrender.com`) — this makes the frontend call the backend directly cross-origin instead of relying on a same-origin proxy.
4. Deploy. Vercel gives you a URL like `https://neoteric-memories.vercel.app`.
5. **Go back to Render** and set `APP_BASE_URL` to this Vercel URL, then trigger a manual redeploy (or just save the env var — Render redeploys automatically on env var changes). This is used for CORS defaults, and as the base for QR/guest links if the admin's browser doesn't send a discoverable Origin header.

## 4. Verify end to end

1. Open the Vercel URL → `/login` → sign in with your admin account.
2. Create/confirm a site and event, upload a few photos, confirm they process.
3. Generate a QR code on the event page — the generated link should use your **Vercel URL** (it's derived from the Origin/Referer header of the browser tab you're using, which will be the Vercel domain since that's where the admin app is running).
4. Scan it on a phone (any network — this is now a real public URL, not LAN-only) and walk through the guest flow.
5. Check the browser's dev tools → Application → Cookies on the Vercel domain: confirm the `nm_session` cookie is present after admin login. If it's missing, double check `NODE_ENV=production` is actually set on Render (it drives the `Secure; SameSite=None` cookie attributes needed for the cross-domain Vercel↔Render setup — see `apps/api/src/lib/cookies.ts`). The guest flow no longer uses a cookie at all (see `apps/api/src/lib/guestToken.ts`) specifically because that cross-site cookie was getting dropped by Safari ITP and in-app browsers (WhatsApp/Instagram) on some devices — instead check that `sessionToken`/`X-Guest-Token` round-trips (Network tab) and that the guest app's `localStorage` has an `nm_guest_<token>` entry after landing.

## Notes

- The background worker (photo processing, retention, Drive sync) runs embedded in the same Render web service process — no separate worker service needed at this scale. If you outgrow a single instance, split it into its own Render **Background Worker** service running `node apps/api/dist/jobs/worker.js` (you'll need to also build that entrypoint — see `apps/api/src/jobs/worker.ts`).
- Render's free tier spins the service down after inactivity and takes ~30-60s to wake up on the next request — fine for internal testing, **not** fine for a live event with guests scanning a QR code. Use at least a paid "Starter" instance (already the `plan: starter` in `render.yaml`) for the actual event day.
- Redeploying Render restarts the process, which restarts the background worker and (only in zero-config ephemeral-DB mode, which you are **not** using once `DATABASE_URL` is set) would reseed — with a real `DATABASE_URL` set, redeploys never touch your data.
