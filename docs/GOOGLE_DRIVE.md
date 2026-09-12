# Google Drive Continuous Sync — Setup Guide

Lets a Photographer/Event Manager drop photos into a Google Drive folder and have them appear in the event automatically, instead of uploading through the admin app. A background job checks each connected folder every `DRIVE_SYNC_INTERVAL_MINUTES` (default 3) for new images and imports them through the exact same pipeline as a manual upload (magic-byte validation, duplicate detection, face indexing).

This feature is **entirely optional** — if `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` aren't set, the "Connect Google Drive" button simply doesn't appear, and manual upload works as always.

## 1. Create a Google Cloud project (one-time)

1. Go to [console.cloud.google.com](https://console.cloud.google.com/) and create a new project (e.g. "Neoteric Memories").
2. **APIs & Services → Library** → search "Google Drive API" → **Enable**.

## 2. Configure the OAuth consent screen

1. **APIs & Services → OAuth consent screen**.
2. User type: **External** (unless you have a Google Workspace org and want **Internal**, which skips verification entirely for your own staff — recommended if available).
3. Fill in the app name ("Neoteric Memories"), support email, developer contact email.
4. Scopes: add `.../auth/drive.readonly` and `.../auth/userinfo.email`.
5. Test users (if the app is in "Testing" status, which is the default and is fine for a pilot): add the Google account(s) your Event Managers/Photographers will connect with. **Unverified apps in Testing mode only work for accounts explicitly added here** — this is the fastest path to a working pilot without Google's app-verification review, but it means only whitelisted accounts can connect. Submitting for verification (needed to let *any* Google account connect) is a longer process — not necessary for an internal pilot.

## 3. Create OAuth credentials

1. **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
2. Application type: **Web application**.
3. **Authorized redirect URIs** — add exactly:
   - Local dev: `http://localhost:4000/api/admin/integrations/google/callback`
   - Production: `https://<your-render-backend-url>/api/admin/integrations/google/callback`
   (Must match `GOOGLE_OAUTH_REDIRECT_URI` — or the API's default of `{API_BASE_URL}/api/admin/integrations/google/callback` — **exactly**, including scheme and no trailing slash.)
4. Save. Copy the **Client ID** and **Client secret**.

## 4. Configure the API

Set in `apps/api/.env` (local) or your host's environment variables (production):

```
GOOGLE_CLIENT_ID=<client id>
GOOGLE_CLIENT_SECRET=<client secret>
GOOGLE_OAUTH_REDIRECT_URI=https://<your-backend-url>/api/admin/integrations/google/callback
DRIVE_SYNC_INTERVAL_MINUTES=3
```

Restart the API. The "Google Drive sync" card now appears on every event's detail page (for Master Admin / Marketing Head / Event Manager).

## 5. Connect a folder (per event)

1. Open the event → **Google Drive sync** card → **Connect Google Drive**.
2. Sign in with a Google account that's on the OAuth consent screen's test-user list (step 2.5) and grant access.
3. You're redirected back to the event page. Paste the Drive **folder link** (or its raw folder ID) into the field shown and click **Set folder**.
   - The folder must be owned by, or shared with, the Google account you just connected.
4. Status flips to **Syncing automatically**. New JPG/PNG files dropped into that folder are imported within `DRIVE_SYNC_INTERVAL_MINUTES`. Use **Sync now** to force an immediate check.

## How it works, and its limits

- Sync is one-way (Drive → Neoteric Memories) and only looks at files directly inside the connected folder (not subfolders), filtered to JPEG/PNG, with `modifiedTime` used as the incremental-sync cursor.
- The stored credential is a Google OAuth **refresh token**, AES-256-GCM encrypted at rest (`apps/api/src/lib/tokenCrypto.ts`) — never the account password, and scoped to `drive.readonly` (the app cannot modify or delete anything in your Drive).
- Disconnecting removes the sync connection only — photos already imported stay in the event.
- If a sync fails (revoked access, folder deleted, quota), the card shows **Last sync failed** with the error message; fix the underlying issue and click **Resume**.
- HEIC files in the folder are skipped with the same "not supported" handling as manual upload — see `docs/ARCHITECTURE.md`.
