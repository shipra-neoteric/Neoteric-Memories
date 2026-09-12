# Privacy and Retention Design

**This document, and all consent/policy copy referenced by it, is a working draft. Final consent language and retention policy require review and sign-off by Neoteric Properties' authorised legal/privacy team before any real pilot or production use.**

## Consent model — three separate, independently-recorded choices

| Consent | Required? | Gates photo retrieval? |
|---|---|---|
| Search purpose (selfie used only to search this event) | **Required** | Yes |
| Match-accuracy disclaimer (probabilistic, may be inaccurate) | **Required** | Yes |
| Retention policy (temporary processing/retention) | **Required** | Yes |
| Marketing contact | Optional, defaults **unchecked** | **No** |
| Marketing photo use | Optional, defaults **unchecked** | **No** |

Enforced server-side, not just in the UI: `consentSubmitSchema` (`packages/shared/src/schemas/consent.ts`) types the three required fields as `z.literal(true)` — a request missing any of them is rejected by validation before it reaches any handler. The optional fields are independent booleans with no effect anywhere in the selfie/search/download code path — grep confirms `optionalAccepted` is stored on `ConsentRecord` and never read again except for admin/marketing reporting purposes.

Every `ConsentRecord` stores: which `ConsentVersion` was shown (full text preserved, versions are never edited in place — a new version is created instead, see admin **Consent Versions**), the exact required/optional selections, a `guardianAssisted` flag, a hashed IP, user agent, and timestamp.

## Guardian / children guidance

Events can be flagged `likelyIncludesChildren` (shown as a checkbox at event creation). When set:
- The guest landing page shows a guardian note.
- The consent screen shows an explicit "a parent/guardian should complete this on your behalf" banner with a `guardianAssisted` acknowledgement checkbox, recorded on the `ConsentRecord`.
- **The system never attempts to determine age automatically** and never claims to — this is a policy flag set by event staff, not an algorithmic determination. No persistent child profile is ever created; a guest's data is handled identically to any other guest's (same session/selfie/retention rules), just with the extra guidance shown.

## What "no OTP" actually relies on

Per the L1 brief, there is deliberately no phone/email verification. The compensating controls, and where each lives in code:

| Control | Implementation |
|---|---|
| Event-specific, unguessable access token | 32 random bytes (`generateSecureToken`), only the SHA-256 hash is ever persisted (`EventAccessToken.tokenHash`) — the raw token exists only in the one-time QR/link response |
| Expiring QR/link | `EventAccessToken.expiresAt`, tied to the event's guest-access window |
| Rate limiting by IP | `guestIpLimiter` (`express-rate-limit`) on the entire `/api/guest/*` surface |
| Rate limiting by device/session | `GuestSession.selfieAttempts` / `.searchCount`, plus a device-hash aggregate check across all of a device's sessions for one event (`checkDeviceSearchLimit`) — stops a guest from resetting limits by re-visiting the landing page for a new session |
| CAPTCHA-ready abstraction | `CaptchaProvider` interface, `CAPTCHA_ENABLED=false` by default — see [ENVIRONMENT.md](ENVIRONMENT.md) |
| Signed, expiring photograph URLs | Every thumbnail/preview/zip URL returned to a guest is time-limited (`SIGNED_URL_TTL_MINUTES`, default 15) |
| Short-lived guest sessions | `GuestSession.expiresAt`, default 24h |
| Max selfie attempts per session | `MAX_SELFIE_ATTEMPTS_PER_SESSION`, default 5 |
| Max searches per device/event | `MAX_SEARCHES_PER_DEVICE_PER_EVENT`, default 8 |
| Abuse/suspicious-activity logging | `SecurityEvent` collection — rate-limit trips, selfie/search-limit exhaustion, multi/no-face detections, auth failures, selfie-deletion failures |
| Instant QR/link disable | Admin **Disable** button → `revokeEventAccessTokens` → immediately fails `resolveGuestAccessToken` for every future request |
| No publicly browsable complete album | There is no route that lists an event's photographs without a matched selfie search behind it; the only photo-serving routes for guests require a `photoId` that is already one of that guest's own `FaceMatch` results |
| High-confidence matches only | `searchEventBySelfie` is called with `minSimilarity` = the event's threshold; nothing below it is ever fetched, stored as a `FaceMatch`, or returned |
| Never "identity verified" | No UI or API response text uses that phrase; results/consent copy consistently says "probabilistic" and "may be inaccurate" |

## What happens to a raw selfie

1. Uploaded selfie bytes are written to temporary storage (`events/{eventId}/selfies/{faceSearchId}.jpg`) only for the duration of the search call.
2. Immediately after the search completes (success **or** failure), a `SELFIE_DELETE` job is enqueued and normally runs within seconds.
3. `SELFIE_MAX_RETENTION_HOURS` (default 24, the spec's hard upper bound) is enforced as a safety net by the retention sweep: any `FaceSearch` whose selfie hasn't been deleted by that deadline is force-deleted and a `CRITICAL` `SecurityEvent` is logged — this is the "selfie deletion failure requiring an alert" case from the edge-case list.
4. A raw selfie is **never** written to any log, and `apps/api/src/lib/logger.ts` explicitly redacts known-sensitive field names as a second layer of defense.
5. Only a SHA-256 `selfieHash` (not the image, not a face embedding) is retained on the `FaceSearch` row, purely for deterministic-test/debugging purposes — it cannot be reversed into an image or a biometric template.

## Face embeddings / biometric data

- **No face embeddings are ever stored in the application's own database.** `IndexedFace` stores only: `providerFaceId` (an opaque reference), `boundingBox`, `confidence`, `photoId`, `eventId`. The actual biometric template lives only inside the face-search provider (Rekognition's collection, or the mock provider's internal `MockFaceIndexEntry` store) — exactly mirroring how a real production system would keep biometric data inside a purpose-built, access-controlled service rather than the general application database.
- Deleting a photo (`deletePhoto`) or an event (`deleteEventCascade`) calls `provider.removePhotoFaces` / `provider.deleteEventCollection` **and** deletes the corresponding `IndexedFace` rows — both sides are cleaned up, not just the database mirror.
- No cross-event face tracking: a person appearing at two different Neoteric events gets two entirely independent provider-side entries in two entirely independent collections. There is no code path that could match them to each other.

## Retention schedule (defaults — see [ENVIRONMENT.md](ENVIRONMENT.md) to override, and [RetentionPolicy admin screen](../apps/web/src/pages/admin/RetentionPoliciesPage.tsx) to manage per-deployment)

| Data | Default retention |
|---|---|
| Guest session | 24h, then marked `EXPIRED` |
| Gallery/download access (signed URLs) | 24h window; ZIP files older than that are deleted by the retention sweep |
| Signed URL | 15 minutes |
| Raw selfie | Deleted immediately after search; 24h hard upper bound |
| Event face index (provider-side) | 45 days by default, per-event configurable via `faceIndexDeleteAt` |
| Original photographs | Per-event `originalPhotoRetentionUntil`, an explicit admin-set date — L1 does not auto-delete original photos on a fixed global schedule; that is an intentional decision requiring an administrator to set a deliberate date per event rather than a silent global default |
| Audit / security logs | Not auto-deleted in L1 — policy-controlled retention for these is a recommended L2 addition (see [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md)) |

## Self-service deletion

A guest can delete their own search/session data at any time from the results screen ("Delete my data" → `DELETE /api/guest/sessions/:id`). This removes `FaceMatch`, `FaceSearch`, and `DownloadJob` records (plus any generated ZIP file) and marks the `GuestSession` `DELETED`, scrubbing its IP/device hashes. `ConsentRecord` is deliberately **kept** — it contains no biometric data or selfie image, and is Neoteric's evidentiary record that consent was actually captured, which the organisation may need to retain for its own compliance purposes; this trade-off should be confirmed with legal counsel.

## No third-party tracking on guest pages

The selfie and results pages load no third-party scripts, analytics, or trackers by default — `apps/api/src/app.ts` sets a permissive-but-scoped CORS policy limited to `APP_BASE_URL`, and the frontend guest routes include nothing beyond the app's own bundle.
