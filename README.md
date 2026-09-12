# Neoteric Memories

**Find Your Event Photos** — event-based, privacy-conscious face-search photo discovery for Neoteric Properties.

Guests scan a per-event QR code, accept consent terms, take a selfie, and see only the photographs of themselves from that one event's private gallery — no accounts, no OTP, no cross-event tracking.

This is the **L1** build: a complete, working system end-to-end using a deterministic mock face-search provider (so it runs with zero paid services), with an Amazon Rekognition adapter behind the same interface for production use.

---

## Quick start (zero external services required)

```bash
npm install
npm run dev:api    # http://localhost:4000 — auto-boots an ephemeral MongoDB and seeds demo data on first run
npm run dev:web    # http://localhost:5173 — admin app + guest journey
```

That's it. `npm run dev:api` prints demo login credentials and guest QR links to the console, and writes them to `apps/api/.seed-output.json`. See [docs/SETUP.md](docs/SETUP.md) for the full walkthrough, including how to open the actual guest QR flow in a browser.

Demo admin login: `admin@neotericproperties.demo` / `NeotericDemo#2026` (all seeded users share this password — see `apps/api/prisma/seedRunner.ts`).

---

## What this is

- **Admin app** (`/admin/*`): Master Admin, Marketing Head, Event Manager, Photographer, Support Executive — create sites/events, generate QR codes, upload and process photographs, monitor guest activity, review wrong-match reports, manage consent versions and retention policies, view audit/security logs.
- **Guest journey** (`/e/:token/*`): QR scan → event landing page → consent → selfie capture → private results gallery → download. No login, no OTP — see [docs/PRIVACY.md](docs/PRIVACY.md) for the compensating controls that replace it.
- **Face search**: pluggable `FaceSearchProvider` interface — a deterministic mock adapter for dev/test/demo, and an Amazon Rekognition adapter for production, both enforcing strict per-event isolation.

## Documentation

| Doc | Contents |
|---|---|
| [docs/SETUP.md](docs/SETUP.md) | Full local setup, seeding, running the guest flow, running tests |
| [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md) | Every environment variable explained |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design, module map, data flow |
| [docs/FACE_PROVIDER.md](docs/FACE_PROVIDER.md) | How the mock provider works, how to calibrate/swap in Rekognition |
| [docs/AWS_DEPLOYMENT.md](docs/AWS_DEPLOYMENT.md) | Creating an AWS account, configuring S3 + Rekognition |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Deploying to Vercel (frontend) + Render (backend) + MongoDB Atlas |
| [docs/GOOGLE_DRIVE.md](docs/GOOGLE_DRIVE.md) | Optional: sync event photos automatically from a Google Drive folder |
| [docs/PRIVACY.md](docs/PRIVACY.md) | Consent model, retention design, what is/isn't deleted and when |
| [docs/RBAC.md](docs/RBAC.md) | Full role/permission matrix and scoping rules |
| [docs/API.md](docs/API.md) | REST API reference |
| [docs/PILOT_TESTING.md](docs/PILOT_TESTING.md) | How to run a real pilot event |
| [docs/PRODUCTION_READINESS.md](docs/PRODUCTION_READINESS.md) | What must happen before a real go-live |

## Monorepo layout

```
apps/api      Express + TypeScript backend, Prisma (MongoDB), background job worker
apps/web      React + Vite + Tailwind — admin app and guest journey
packages/shared  Zod schemas, RBAC matrix, shared constants/types
```

## Tech stack

TypeScript everywhere · React + Vite + Tailwind · Node.js + Express · Prisma ORM on **MongoDB** (Atlas for real use; an ephemeral in-process MongoDB via `mongodb-memory-server` for zero-config dev/test) · Zod validation · AWS S3-compatible storage behind a provider interface · Amazon Rekognition behind a provider interface, with a deterministic mock for dev/CI · Vitest + Playwright.

MongoDB was substituted for the originally-suggested PostgreSQL at the user's explicit request; see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for what that changes (no DB-level foreign keys/cascades, `prisma db push` instead of migrations).

## Status

This is a working L1 implementation, not a finished production system. Read [docs/PRODUCTION_READINESS.md](docs/PRODUCTION_READINESS.md) and the "Known limitations" section of the final completion report before any real deployment — in particular, the face-match confidence threshold is a starting point that **must** be calibrated against real Neoteric event photography, and all consent/retention copy is a draft pending legal review.
