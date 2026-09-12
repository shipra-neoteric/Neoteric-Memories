# Production-Readiness Checklist

Use this before any real (non-pilot) production go-live. Items are grouped by what they block.

## Must do before ANY real guest data is processed

- [ ] Legal/privacy review and sign-off on all consent text (`ConsentVersion`) and this repo's `docs/PRIVACY.md`.
- [ ] Set real `JWT_SECRET` / `COOKIE_SECRET` (the app refuses to boot in production with the shipped defaults, but confirm your deployment actually sets `NODE_ENV=production`).
- [ ] `DATABASE_URL` pointed at a real MongoDB Atlas cluster with network access restricted to your application's egress, not `0.0.0.0/0`.
- [ ] `STORAGE_PROVIDER=s3` with a private bucket, bucket-level encryption, and an IAM role (not long-lived access keys) — see [AWS_DEPLOYMENT.md](AWS_DEPLOYMENT.md).
- [ ] `FACE_PROVIDER=rekognition` with a **calibrated** threshold (never the unverified L1 default) — see [FACE_PROVIDER.md](FACE_PROVIDER.md).
- [ ] TLS termination in front of the API; confirm cookies are actually being sent `Secure`.

## Must do before scaling beyond a small pilot

- [ ] Run the background worker as its own scaled process (`npm run worker`), separate from the HTTP server.
- [ ] Stream ZIP generation to storage instead of buffering the whole archive in memory (`apps/api/src/jobs/processors/zipGenerate.ts` currently buffers in memory — fine for a guest's own capped result set, but revisit before any bulk/admin-initiated export feature).
- [ ] Load-test the guest endpoints against your actual `express-rate-limit` settings for a realistic "QR scanned by a crowd at once" burst.
- [ ] Put a WAF/CDN in front of the API for guest traffic.
- [ ] Add a policy-controlled retention/rotation schedule for `AuditLog`/`SecurityEvent` (currently unbounded — see [PRIVACY.md](PRIVACY.md)).

## Should do soon (not blocking, but recommended)

- [ ] Promote Role/Permission to DB-backed, admin-editable tables if you need per-deployment customization beyond the fixed code matrix (see [RBAC.md](RBAC.md)).
- [ ] Implement HEIC→JPEG conversion (currently rejected with a clear message; L1 deliberately did not add a native/WASM HEIC decoder dependency — see [ARCHITECTURE.md](ARCHITECTURE.md)) if iPhone photographers are common.
- [ ] Wire up a real CAPTCHA provider (`CAPTCHA_ENABLED=true`) if guest abuse becomes a real problem beyond what rate limiting + session/device counters catch.
- [ ] Implement `LIVENESS_PROVIDER=aws` (Rekognition Face Liveness) if spoofing (photo-of-a-photo) becomes a concern for your events.
- [ ] Structured log shipping (the current logger is a dependency-free JSON-to-stdout logger with basic field redaction — fine for a single process, but wire it into your actual log aggregation platform).
- [ ] Automated DB backups for Atlas (Atlas offers this natively — just confirm it's actually turned on for your cluster/tier).
- [ ] CI pipeline running `npm run build && npm run typecheck && npm run lint && npm test` (API) and the Playwright suite on every PR — this repo has all the pieces, wiring an actual CI workflow file was out of scope for this session.

## Verified working in this session vs. not personally verified

**Personally verified** (see the final completion report for exact commands/output): typecheck across all three workspaces, production build of the shared/API/web packages, the full Vitest suite against a real (not mocked) MongoDB via `mongodb-memory-server`, and manual browser testing of the core admin and guest flows in mock mode.

**Not personally verified in this session** (no credentials/infrastructure available): Amazon Rekognition against a live AWS account, S3 against a real bucket, MongoDB Atlas specifically (vs. a real local `mongod`), and any load/scale testing. Treat all AWS-specific and Atlas-specific configuration as reviewed-but-unverified until run once for real.
