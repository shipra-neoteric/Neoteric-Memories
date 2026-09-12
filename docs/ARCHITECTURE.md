# Architecture

## High level

```
apps/web  (React + Vite + Tailwind)
   │  admin app (/admin/*)            guest journey (/e/:token/*)
   ▼
apps/api  (Express + TypeScript)
   │
   ├── modules/*        domain logic + HTTP routes (auth, sites, users, events, photos,
   │                    consent, guest, retention, audit, reports, dashboard, files)
   ├── providers/*       swappable interfaces: StorageProvider, FaceSearchProvider,
   │                    CaptchaProvider, LivenessProvider
   ├── jobs/*            DB-polling background worker + processors (photo processing,
   │                    ZIP generation, selfie deletion, retention sweep, event
   │                    collection deletion)
   └── prisma/           schema + seed
   ▼
MongoDB (via Prisma's mongodb connector) — Atlas in real use, ephemeral in-process
for zero-config dev/test (see "Database" below)
```

`packages/shared` holds Zod schemas, the RBAC permission matrix, and constants shared between the API and the web app, so validation rules and role/permission logic can never drift between frontend and backend.

## Why MongoDB instead of PostgreSQL

The task's default stack suggested PostgreSQL + Prisma. The user explicitly asked for **MongoDB Atlas** instead. Prisma has a first-class `mongodb` connector, so we kept Prisma as the ORM and only swapped the datasource. Practical consequences:

- **No DB-level foreign keys or cascading deletes.** Every "when X is deleted, also delete Y, Z, and tell the face provider" rule is explicit application code — see `apps/api/src/modules/events/deleteEventCascade.ts` and `apps/api/src/modules/photos/service.ts#deletePhoto`. This is actually a reasonable fit here: the requirement that biometric provider state be *actually* removed (not just DB rows) always needed application-level orchestration regardless of the underlying database.
- **No SQL migration history.** Schema changes are applied with `prisma db push` rather than `prisma migrate`. For a MongoDB-backed L1 this is normal and accepted practice; a team wanting versioned migrations for MongoDB would look at a dedicated migration tool in L2.
- **IDs are ObjectId strings**, not UUIDs/serials.
- Two models — `AdminSession` and `MockFaceIndexEntry` — exist purely to support the app (refresh-token storage, and the mock face provider's own internal index) and aren't part of the domain model list in the spec; both are called out as such in `schema.prisma` comments.

## Database — zero-config ephemeral mode

If `DATABASE_URL` is unset, `apps/api/src/db.ts#connectDatabase()` boots an in-process MongoDB via `mongodb-memory-server` (a real `mongod` binary, not a fake). `server.ts` detects this case and automatically runs the same seed logic used by `npm run seed`, so **`npm run dev:api` alone is a fully working, pre-populated demo with no external services** — directly satisfying "mock mode works without paid services" for the whole stack, not just face search. Data does not survive a restart in this mode; set `DATABASE_URL` for anything persistent.

The same ephemeral-boot mechanism is what test/setup.ts uses for `apps/api`'s Vitest suite — every test run gets its own fresh, isolated database.

## Event isolation (the non-negotiable rule)

Every `FaceSearchProvider` method is scoped by `eventId` — there is no "search everything" method on the interface (see `apps/api/src/providers/faceSearch/FaceSearchProvider.ts`). Concretely:

- `neoteric-event-{eventId}` is the collection id, used by both the mock provider (as a query filter on its own internal `MockFaceIndexEntry` collection) and the Rekognition adapter (as the actual Rekognition `CollectionId`).
- `performSelfieSearch` (guest module) re-verifies every returned match still belongs to the requested event and is in a guest-visible photo state, as defense in depth on top of the provider-level scoping.
- Deleting an event (`deleteEventCascade`) calls `provider.deleteEventCollection(eventId)` and removes every `IndexedFace` row for that event — nothing lingers that could later be searched.

`test/unit/mockFaceProvider.test.ts` has a dedicated "never returns a match from a different event" test.

## Background jobs

No Redis/BullMQ for L1 — a `BackgroundJob` Mongo collection plus a simple polling loop (`apps/api/src/jobs/loop.ts`) is enough at this scale and keeps local setup to zero extra services. Jobs are claimed with an optimistic `updateMany({where:{id, status:'QUEUED'}})` (only the caller that flips `QUEUED → RUNNING` proceeds), retried with exponential backoff up to `maxAttempts`, and always enqueued through `enqueueJob()`, which is idempotent on a unique `idempotencyKey` — that's the concrete mechanism behind "idempotent uploads, indexing, deletion and ZIP jobs".

The same worker loop runs embedded inside the `dev:api`/`start` process by default; `npm run worker` is a standalone entrypoint for running it as a separate scaled-out process in production.

## Mock face provider

See [FACE_PROVIDER.md](FACE_PROVIDER.md) — it's the single most important design decision to understand before touching guest-flow code.

## Consent, retention, audit

- `ConsentRecord` always stores which exact `ConsentVersion` was shown and what was accepted, never overwritten — that's the consent-version history requirement.
- `AuditLog` covers sensitive admin actions (event delete, QR disable/regenerate, user create, consent-version changes, retention-policy changes, manual retention runs). `SecurityEvent` covers abuse/suspicious-activity signals (rate limiting, selfie-attempt/search-limit exhaustion, multiple/no-face detections, auth failures, selfie-deletion failures).
- Retention is enforced by `runRetentionSweep()` (`apps/api/src/jobs/processors/retentionSweep.ts`), callable both from the scheduled worker loop and manually from the admin **Retention Policies → Run sweep now** button — both paths call the exact same idempotent function.

## Frontend

- `apps/web/src/layout/*` — admin shell (sidebar filtered by the caller's RBAC permissions, header with theme toggle + profile menu).
- `apps/web/src/guest/*` — the mobile-first guest journey as nested routes under `/e/:token`, sharing state (session id, in-progress search id) via `GuestFlowContext` + `sessionStorage` (survives a page refresh mid-flow).
- `apps/web/src/components/ui/*` — a small design-system layer following `UI_STYLE_GUIDE.md` (Inter font, dynamic `--theme-primary` orange via `useTheme().getThemeColor()`, dark-mode-via-`.dark`-class, drawer pattern for create/edit forms, status-badge color map, custom `Select` instead of native `<select>`, `sweetalert2` for confirmations/toasts instead of `window.confirm`/`alert`).

## Request flow: guest selfie search (the core path)

1. `GET /api/guest/events/:token` — resolves the hashed access token, checks event status/window, creates-or-reuses a `GuestSession` (httpOnly cookie), returns landing info + the active `ConsentVersion`.
2. `POST /api/guest/sessions/:id/consent` — records a `ConsentRecord`; selfie submission is blocked until this exists.
3. `POST /api/guest/sessions/:id/selfie` (multipart) — validates the guest session/event/consent, enforces per-session selfie-attempt and per-device search-count limits, magic-byte-validates the image, runs `faceProvider.detectFaces()` to reject 0 or >1 faces or a too-small face, stores the selfie temporarily, calls `faceProvider.searchEventBySelfie()` (event-scoped, threshold-filtered), re-verifies each match's photo is still guest-visible, persists only `HIGH`-band `FaceMatch` rows, and immediately enqueues selfie deletion.
4. `GET /api/guest/sessions/:id/searches/:searchId/results` — returns only the persisted high-confidence matches with short-lived signed thumbnail URLs.
5. Download endpoints only ever accept a `photoId` that is actually one of that search's own `FaceMatch` rows — a guest can never request an arbitrary event photo by id (see `apps/api/src/modules/guest/download.ts`).
