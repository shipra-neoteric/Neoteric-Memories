# Environment Variables

All backend variables live in `apps/api/.env` (copy from `apps/api/.env.example`). They are validated at startup with Zod (`apps/api/src/env.ts`) — the process refuses to start if something required is missing or malformed, and refuses to start **in production** with the insecure default secrets.

## Core

| Variable | Default | Notes |
|---|---|---|
| `NODE_ENV` | `development` | `development` \| `test` \| `production` |
| `PORT` | `4000` | API port |
| `APP_BASE_URL` | `http://localhost:5173` | Used to build guest QR/URL links and as the CORS origin |
| `API_BASE_URL` | `http://localhost:4000` | Used to build local-storage signed file URLs |

## Database

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | *(empty)* | A MongoDB connection string. **Leave empty for zero-config dev** — the API boots an ephemeral in-process MongoDB via `mongodb-memory-server` and auto-seeds it. Set to a MongoDB Atlas URI (`mongodb+srv://...`) for anything persistent. **Required** when `NODE_ENV=production`. |

## Auth

| Variable | Default | Notes |
|---|---|---|
| `JWT_SECRET` | insecure dev default | Signs admin access tokens. **Must** be overridden in production (refused otherwise). |
| `COOKIE_SECRET` | insecure dev default | HMAC key for CSRF tokens, signed-URL keys (local storage), and hashed IP/device fingerprints. **Must** be overridden in production. |
| `ACCESS_TOKEN_TTL_MINUTES` | `30` | Admin JWT lifetime |
| `REFRESH_TOKEN_TTL_HOURS` | `12` | Admin refresh-token (DB-backed `AdminSession`) lifetime |

## Storage

| Variable | Default | Notes |
|---|---|---|
| `STORAGE_PROVIDER` | `local` | `local` (writes to disk, dev/demo only) or `s3` |
| `LOCAL_STORAGE_DIR` | `./storage` | Only used by the local provider |
| `S3_BUCKET` / `S3_REGION` | — | Required when `STORAGE_PROVIDER=s3` |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | — | Optional — omit to use the AWS SDK's default credential chain (IAM role, etc.) |
| `S3_ENDPOINT` | — | Only for a non-AWS S3-compatible endpoint (MinIO, Cloudflare R2, ...) |

## Face search

| Variable | Default | Notes |
|---|---|---|
| `FACE_PROVIDER` | `mock` | `mock` (deterministic, no AWS) or `rekognition` |
| `AWS_REGION` / `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | — | Required when `FACE_PROVIDER=rekognition`; also reused by the S3 provider if you don't set `S3_*` separately |

## Policy defaults

All of these override the code defaults in `packages/shared/src/constants.ts`. See [PRIVACY.md](PRIVACY.md) for what each one means and the recommended values.

| Variable | Default |
|---|---|
| `HIGH_CONFIDENCE_THRESHOLD` | `92` |
| `GUEST_SESSION_TTL_HOURS` | `24` |
| `SIGNED_URL_TTL_MINUTES` | `15` |
| `SELFIE_MAX_RETENTION_HOURS` | `24` |
| `MAX_SELFIE_ATTEMPTS_PER_SESSION` | `5` |
| `MAX_SEARCHES_PER_DEVICE_PER_EVENT` | `8` |

Per-event overrides (`matchThreshold` on the Event record) take precedence over these when set.

## CAPTCHA (disabled by default)

| Variable | Default | Notes |
|---|---|---|
| `CAPTCHA_ENABLED` | `false` | The guest routes already call through `getCaptchaProvider()` — turning this on needs no route changes, but `recaptcha`/`turnstile` have no concrete HTTP-verify implementation yet in L1 (see `apps/api/src/providers/captcha`) |
| `CAPTCHA_PROVIDER` | `none` | `none` \| `recaptcha` \| `turnstile` |
| `CAPTCHA_SECRET_KEY` | — | |

## Liveness detection

| Variable | Default | Notes |
|---|---|---|
| `LIVENESS_PROVIDER` | `mock` | `mock` always reports "live" (dev/demo only). `aws` (Rekognition Face Liveness) is **not implemented** in L1 — it requires a client-SDK-driven session flow beyond a single server call. See `apps/api/src/providers/liveness`. |

## Google Drive continuous sync (optional)

| Variable | Default | Notes |
|---|---|---|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | — | OAuth client from Google Cloud Console. Leave both unset to disable the feature entirely — the "Connect Google Drive" button is hidden. See [GOOGLE_DRIVE.md](GOOGLE_DRIVE.md). |
| `GOOGLE_OAUTH_REDIRECT_URI` | `{API_BASE_URL}/api/admin/integrations/google/callback` | Must exactly match an "Authorized redirect URI" on the OAuth client. |
| `DRIVE_SYNC_INTERVAL_MINUTES` | `3` | How often connected folders are checked for new photos. |

## Frontend (`apps/web`)

| Variable | Default | Notes |
|---|---|---|
| `VITE_API_BASE_URL` | *(empty → relative paths)* | Only needed if the web app is **not** served from the same origin/reverse proxy as the API in production (e.g. the Vercel + Render split — see [DEPLOYMENT.md](DEPLOYMENT.md)). In dev, Vite's proxy (`apps/web/vite.config.ts`) forwards `/api` and `/files` to `http://localhost:4000`. |
