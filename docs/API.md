# API Reference

Base URL: `API_BASE_URL` (default `http://localhost:4000`). All request/response bodies are JSON unless noted. Admin routes use httpOnly cookies for auth (never send credentials via headers/localStorage) plus a `X-CSRF-Token` header on state-changing requests, echoing the non-httpOnly `nm_csrf` cookie set at login. Guest routes use a signed `sessionToken` (returned once by `GET /guest/events/:token` and echoed back on every later guest request as the `X-Guest-Token` header) instead of a cookie — the guest app and API are cross-domain, and a cross-site cookie gets silently dropped by Safari ITP and in-app browsers (WhatsApp/Instagram) on some devices. Every guest response is scoped to that one token's session.

Errors are always `{ "error": { "code": string, "message": string, "details"?: unknown } }` with a matching HTTP status.

## Admin auth — `/api/admin/auth`

| Method | Path | Notes |
|---|---|---|
| POST | `/login` | `{ email, password }` → sets session cookies, returns `{ user, csrfToken }` |
| POST | `/refresh` | Rotates the refresh token, reissues an access token |
| POST | `/logout` | Revokes the current refresh token, clears cookies |
| GET | `/me` | Current user (requires auth) |

## Sites — `/api/admin/sites` (auth required)

| Method | Path | Permission |
|---|---|---|
| GET | `/` | `site:view` — scoped to accessible sites for non-admins |
| POST | `/` | `site:manage` |
| PATCH | `/:id` | `site:manage` |

## Users — `/api/admin/users` (auth required, `user:manage`)

`GET /`, `POST /`, `PATCH /:id`, `GET /:id/site-access`.

## Events — `/api/admin/events` (auth required)

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/` | `event:view` | Scoped by site (Marketing Head) or assignment (Event Manager/Photographer) |
| POST | `/` | `event:create` + site access | Creates in `DRAFT`, provisions the event's face collection |
| GET | `/:id` | `event:view` + assignment | Includes photo stats, batches, assignments, indexed-face count, active-token status |
| PATCH | `/:id` | `event:edit` + assignment | Partial update |
| GET | `/:id/readiness` | `event:view` + assignment | `{ ready, reasons[] }` — also auto-promotes `DRAFT/UPLOADING/PROCESSING → READY` when criteria are met |
| POST | `/:id/status` | `event:close` + assignment | `{ status: 'LIVE'\|'PAUSED'\|'CLOSED'\|'ARCHIVED', reason? }` — validated against the lifecycle graph |
| POST | `/:id/access-token` | `event:manage_qr` + assignment | Generates (or regenerates, invalidating the previous one) the guest QR/link — **raw token returned exactly once** |
| POST | `/:id/access-token/revoke` | `event:manage_qr` + assignment | Instantly disables guest access |
| POST | `/:id/assignments` | `event:manage_assignments` | `{ userId, role: 'EVENT_MANAGER'\|'PHOTOGRAPHER' }` |
| DELETE | `/:id/assignments/:userId` | `event:manage_assignments` | |
| POST | `/:id/cover` | `event:edit` + assignment | multipart `cover` file |
| DELETE | `/:id` | `event:delete` | Master Admin only in practice — full cascade delete including provider-side biometric data |

## Photos — `/api/admin/events/:id/photos` (auth required)

| Method | Path | Permission | Notes |
|---|---|---|---|
| POST | `/` | `photo:upload` + assignment | multipart, field name `photos` (multiple). Returns `{ accepted[], duplicates[], rejected[] }` |
| GET | `/` | `photo:view` + assignment | `?page&pageSize&status` |
| GET | `/:photoId/preview-url` | `photo:view` + assignment | Short-lived signed URL |
| POST | `/:photoId/retry` | `photo:upload` + assignment | Re-queues a failed photo |
| PATCH | `/:photoId/archive` | `photo:delete` + assignment | `{ archived: boolean }` |
| DELETE | `/:photoId` | `photo:delete` + assignment | Hard delete, removes provider-side face index too |

## Consent versions — `/api/admin/consent-versions` (`consent:manage`)

`GET /`, `POST /`, `PATCH /:id/deactivate`.

## Retention policies — `/api/admin/retention-policies` (`retention:manage`)

`GET /`, `POST /`, `PATCH /:id`, `POST /run-now` (runs the retention sweep immediately, returns counts).

## Audit — `/api/admin/audit` (`audit:view`)

`GET /logs?page&pageSize&entityType&eventId`, `GET /security-events?page&pageSize`.

## Dashboard — `/api/admin/dashboard` (`analytics:view`)

Aggregate counts (active/upcoming events, photo/processing stats, search stats, downloads, open reports, storage usage, events nearing guest-access expiry) scoped to the caller's accessible events.

## Reports — `/api/admin/reports` (`report:view` / `report:resolve`)

`GET /?page&pageSize&status`, `PATCH /:id/resolve` with `{ status: 'REVIEWED'|'DISMISSED' }`.

## Guest — `/api/guest` (no auth; rate-limited; cookie-scoped)

| Method | Path | Notes |
|---|---|---|
| GET | `/events/:token` | Resolves the access token. Returns `{ ok:false, reason }` for invalid/expired/revoked/paused/closed/not-open-yet/not-ready, or `{ ok:true, sessionId, event, consentVersion, consentAlreadyGiven }` |
| POST | `/sessions/:sessionId/consent` | `{ required:{...}, optional:{...}, guardianAssisted }` — required fields must all be `true` |
| POST | `/sessions/:sessionId/selfie` | multipart, field `selfie`. `X-Capture-Source: camera\|upload`. Returns `201 { ok:true, faceSearchId, resultCount }` on success, `422 { ok:false, reason, message }` for a rejected image (no/multiple/too-small face), `429` once selfie attempts are exhausted, `409` if the event is paused/not live |
| GET | `/sessions/:sessionId/searches/:searchId/results` | High-confidence matches only, with short-lived signed thumbnail URLs, plus the probabilistic-matching disclaimer text |
| POST | `/sessions/:sessionId/searches/:searchId/report-wrong-match` | `{ photoId, note? }` — `photoId` must be one of that search's own results |
| GET | `/sessions/:sessionId/searches/:searchId/photos/:photoId/download-url` | Signed URL for one photo — `photoId` must be one of that search's own results |
| POST | `/sessions/:sessionId/searches/:searchId/download-zip` | `{ photoIds?[], all? }` — enqueues a ZIP job, returns `{ downloadJobId }` |
| GET | `/sessions/:sessionId/downloads/:downloadJobId` | Poll job status; `{ status, url }` once `COMPLETED` |
| DELETE | `/sessions/:sessionId` | Self-service deletion of search/download data for this session |

## Files — `/files/:key` (local storage provider only)

Signed-URL-verified static file serving for the dev/demo `local` storage provider (`?exp&sig&dl`). Not used at all when `STORAGE_PROVIDER=s3` — S3 presigned URLs point straight at AWS.
