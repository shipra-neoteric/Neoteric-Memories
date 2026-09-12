# Pilot Testing Guide

A practical checklist for running Neoteric Memories at a real (small, controlled) Neoteric Properties event for the first time.

## Before the event

1. **Switch to a real face provider.** Mock mode is for development/demo only — set `FACE_PROVIDER=rekognition` with real AWS credentials (see [AWS_DEPLOYMENT.md](AWS_DEPLOYMENT.md)).
2. **Calibrate the threshold with a dry run.** A few days before, take 30-50 photos of willing colleagues/staff in similar lighting to the venue, index them into a throwaway test event, and have each person submit a selfie. Check the similarity scores of true matches vs. any lookalike/false positives, and set `matchThreshold` (per-event) or `HIGH_CONFIDENCE_THRESHOLD` (global) accordingly — see [FACE_PROVIDER.md](FACE_PROVIDER.md).
3. **Have legal/privacy review the consent text** for the `ConsentVersion` you'll assign to this event — L1 ships only draft wording.
4. **Create the event** with real dates, retention dates, and venue. Mark `likelyIncludesChildren` if applicable.
5. **Assign a Photographer and an Event Manager** to the event.
6. **Print the QR poster** ahead of time once you're confident you won't need to regenerate it (regenerating invalidates the previous link/QR).
7. **Test the whole guest journey yourself** on a phone, on the actual venue wifi/cellular if possible, before guests arrive: scan → consent → selfie → results → download.
8. Confirm `selfieUploadFallbackEnabled` is set the way you want — enabling it helps guests whose phone camera/browser has trouble with `getUserMedia`, at the cost of guests being able to submit any photo rather than a live capture.

## During the event

1. Photographer(s) upload photo batches throughout the event via the admin app (works from a phone browser too) — don't wait until the end; guests can start finding photos as soon as early batches finish processing.
2. Watch the event detail page's photo-status counts — a spike in `FAILED` usually means a bad/corrupt file; retry it or investigate.
3. Keep an eye on **Dashboard → Processing queue** — if it's growing faster than it's draining, the worker may need more capacity (see `docs/AWS_DEPLOYMENT.md#7-background-worker`).
4. If something goes wrong (wrong QR posted, need to pause for any reason), use **Pause** on the event — this blocks new guest selfie submissions immediately without destroying anything, and can be reversed with **Go Live** again.

## After the event

1. **Close** the event once guest access should end (or let `guestAccessExpiresAt` do it automatically).
2. Review **Wrong-Match Reports** for this event — a report doesn't automatically mean a bug, but a cluster of reports on the same photo is worth investigating (crowd density, lighting, or a threshold that's too permissive for that specific photo).
3. Check **Audit & Security** for anything unexpected (rate-limit trips, repeated auth failures, selfie-deletion failures).
4. Confirm retention dates on the event are what you actually want — `faceIndexDeleteAt` and `originalPhotoRetentionUntil` were set at creation and can still be adjusted from the event page if plans changed.

## Testing retention/deletion for real

Don't wait for real time to pass. As Master Admin: **Retention Policies → Run sweep now**. This is the exact same function the scheduler calls automatically every 5 minutes, so what you see is exactly what would happen in production once the relevant dates pass.

## Known constraints to communicate to event staff before a pilot

- HEIC photos (iPhone default format) are currently rejected with an explicit message — ask photographers to export/shoot JPEG, or convert before upload (see [ARCHITECTURE.md](ARCHITECTURE.md) and the "Known limitations" section of the completion report).
- A guest gets a limited number of selfie attempts and searches per event (defaults: 5 attempts/session, 8 searches/device/event) — if a legitimate guest hits this (e.g., a shared family phone searching for multiple people), event staff should be ready to explain or, if truly needed, an admin can review `GuestSession` records for that device.
- The mock provider must never be used for a real pilot — verify `FACE_PROVIDER=rekognition` is actually set in whatever environment the pilot points at.
