# Local Setup Guide

## Prerequisites

- Node.js 20+ (developed/tested on Node 24)
- npm 10+
- No Docker, no MongoDB install, no AWS account required for local development.

## 1. Install

```bash
npm install
```

This installs all three workspaces (`packages/shared`, `apps/api`, `apps/web`).

## 2. Build the shared package once

```bash
npm run build -w @neoteric-memories/shared
```

(`apps/api` and `apps/web` both depend on `@neoteric-memories/shared`'s compiled output. Re-run this if you change anything under `packages/shared/src`.)

## 3. Generate the Prisma client

```bash
cd apps/api
npx prisma generate
```

## 4. Run the API

```bash
npm run dev:api
```

On first run, if you have not set `DATABASE_URL` in `apps/api/.env`, the API:

1. Boots an ephemeral, in-process MongoDB (via `mongodb-memory-server` — downloads a real `mongod` binary the very first time, which can take a minute on a slow connection; cached after that).
2. Seeds realistic demo data automatically (sites, users, three live events with processed demo photographs and active QR links).
3. Starts listening on `http://localhost:4000` and starts the background job worker in the same process.

Watch the console — it prints every demo login and every guest QR URL. The same information is written to `apps/api/.seed-output.json`.

**This ephemeral database does not persist across restarts.** Every time you stop and restart `npm run dev:api` without `DATABASE_URL` set, you get a fresh, freshly-seeded database. That's intentional for a zero-friction demo loop. To persist data, either:
- run a local MongoDB via `docker compose up -d` (see the root `docker-compose.yml`) and set `DATABASE_URL=mongodb://localhost:27017/neoteric_memories?replicaSet=rs0` in `apps/api/.env`, or
- point `DATABASE_URL` at a MongoDB Atlas cluster (see [ENVIRONMENT.md](ENVIRONMENT.md)).

In either of those cases, seed explicitly with `npm run seed -w @neoteric-memories/api` (also idempotent — safe to re-run).

## 5. Run the web app

In a second terminal:

```bash
npm run dev:web
```

Open `http://localhost:5173`.

## 6. Sign in to the admin app

Go to `http://localhost:5173/login` and use one of the seeded accounts (all share the same demo password):

| Role | Email |
|---|---|
| Master Admin | `admin@neotericproperties.demo` |
| Marketing Head | `marketing@neotericproperties.demo` |
| Event Manager | `eventmanager@neotericproperties.demo` |
| Photographer | `photographer@neotericproperties.demo` |
| Support Executive | `support@neotericproperties.demo` |

Password for all: `NeotericDemo#2026`

These are **development-only** credentials, seeded locally by `apps/api/prisma/seedRunner.ts` — never used in any deployed environment.

## 7. Try the guest journey

Open `apps/api/.seed-output.json` (or the console output from step 4) and copy a `guestUrl`, e.g.:

```
http://localhost:5173/e/<long-random-token>
```

Open it in a browser (or a phone on the same network, adjusting `APP_BASE_URL`/host accordingly). Walk through: landing → "Find My Photos" → accept consent → selfie.

**Important for the mock provider**: your real webcam selfie of your real face will *correctly* find nothing, because the mock provider does not do real face recognition — see [FACE_PROVIDER.md](FACE_PROVIDER.md). To see a real match end-to-end, use the **"Upload a selfie instead"** button (enabled by default on seeded demo events) and upload one of the generated fixture files at `apps/api/seed-assets/demo-selfies/person-1.jpg` (or `person-2.jpg`, `person-4.jpg`). You'll get back the seeded demo photograph(s) containing that same synthetic "person".

## 8. Create your own event manually

1. Sign in as Master Admin or Marketing Head.
2. **Sites** → create a site (or use a seeded one).
3. **Events** → New event → fill in dates/retention/venue → Create (starts as Draft).
4. On the event page: assign a **Consent Version** (create one under **Consent Versions** first if needed), upload photographs (JPG/PNG — drag files onto "Upload photos"), wait for them to show `PROCESSED`.
5. Once the readiness banner clears, click **Go Live**.
6. Click **Generate QR** — download the PNG immediately, it is shown only once.
7. Open the guest URL to test the real flow with photos you uploaded yourself.

## Running tests

```bash
# API unit + integration tests (spins up its own ephemeral MongoDB automatically)
cd apps/api
npm run test

# Web production build + typecheck
cd apps/web
npm run build

# Playwright E2E (starts both dev servers automatically; run `npm run seed -w @neoteric-memories/api` once first if you want the guest E2E test to find a fresh QR link)
cd apps/web
npm run test:e2e
```

## Verification commands (run from the repo root unless noted)

```bash
npm run build          # builds shared, api, web in order
npm run typecheck       # typechecks all three workspaces
npm run lint            # eslint on api + web
cd apps/api && npm run test         # vitest
cd apps/web && npm run test:e2e     # playwright
```

## Testing retention / deletion manually

1. As Master Admin, go to **Retention Policies** → **Run sweep now**. This runs the same job the scheduler runs every 5 minutes, and shows you the counts of what it touched.
2. To see selfie force-deletion and event-index deletion fire realistically without waiting real days, use the API tests (`apps/api/test/integration/retention.test.ts`) as a reference — they manipulate `createdAt`/`faceIndexDeleteAt` directly and call `runRetentionSweep()`, which is exactly what the scheduled job calls.
3. As a guest, after a search, use **"Delete my data"** on the results page and confirm the search/session disappears from further access (a second request against the same session ID after deletion will fail).
