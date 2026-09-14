import { google } from 'googleapis'
import type { drive_v3 } from 'googleapis'
import { env } from '../../env.js'
import { decryptSecret } from '../../lib/tokenCrypto.js'
import { assertNotTestRuntime, isTestRuntime } from '../../lib/testGuard.js'

export function isDriveIntegrationConfigured(): boolean {
  // env.ts already blanks out the GOOGLE_* vars under the test runtime, so this would
  // already return false in practice — this explicit check is a second, independent
  // layer that reports "not configured" even if real credentials somehow leaked through.
  if (isTestRuntime()) return false
  return !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)
}

function requireConfig() {
  if (!isDriveIntegrationConfigured()) {
    throw new Error('Google Drive integration is not configured — set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.')
  }
}

function redirectUri(): string {
  return env.GOOGLE_OAUTH_REDIRECT_URI ?? `${env.API_BASE_URL}/api/admin/integrations/google/callback`
}

function newOAuthClient() {
  assertNotTestRuntime('Google OAuth2 client')
  requireConfig()
  return new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, redirectUri())
}

const DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive.readonly', 'https://www.googleapis.com/auth/userinfo.email']

/** `state` should already be signed/verifiable — see lib/oauthState.ts. */
export function buildGoogleConsentUrl(state: string): string {
  const client = newOAuthClient()
  return client.generateAuthUrl({
    access_type: 'offline', // required to get a refresh_token
    prompt: 'consent', // force re-consent so we reliably get a refresh_token even on a reconnect
    scope: DRIVE_SCOPES,
    state,
  })
}

export async function exchangeCodeForRefreshToken(code: string): Promise<{ refreshToken: string; email: string | null }> {
  const client = newOAuthClient()
  const { tokens } = await client.getToken(code)
  if (!tokens.refresh_token) {
    throw new Error(
      'Google did not return a refresh token. This usually means the account already granted access previously without "prompt=consent" — try disconnecting and reconnecting.'
    )
  }
  client.setCredentials(tokens)
  let email: string | null = null
  try {
    const oauth2 = google.oauth2({ auth: client, version: 'v2' })
    const info = await oauth2.userinfo.get()
    email = info.data.email ?? null
  } catch {
    // Non-fatal — email is only used for display in the admin UI.
  }
  return { refreshToken: tokens.refresh_token, email }
}

/** A ready-to-use Drive client for a stored (encrypted) integration — auto-refreshes its own access token from the refresh token as needed. */
export function driveClientForRefreshTokenEnc(refreshTokenEnc: string): drive_v3.Drive {
  const client = newOAuthClient()
  client.setCredentials({ refresh_token: decryptSecret(refreshTokenEnc) })
  return google.drive({ version: 'v3', auth: client })
}

/** Accepts a raw folder id or a full Drive folder URL and returns just the id. */
export function extractFolderId(input: string): string {
  const trimmed = input.trim()
  const urlMatch = trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/)
  if (urlMatch) return urlMatch[1]
  const idParamMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/)
  if (idParamMatch) return idParamMatch[1]
  return trimmed
}

export async function getFolderName(drive: drive_v3.Drive, folderId: string): Promise<string> {
  const res = await drive.files.get({ fileId: folderId, fields: 'id, name, mimeType', supportsAllDrives: true })
  if (res.data.mimeType !== 'application/vnd.google-apps.folder') {
    throw new Error('That Drive link/ID does not point to a folder.')
  }
  return res.data.name ?? folderId
}

export interface DriveImageFile {
  id: string
  name: string
  mimeType: string
  modifiedTime: string
}

/**
 * Lists image files in a folder modified after `sinceIso` (or all images if unset),
 * newest-safe pagination handled internally.
 *
 * Deliberately broad on mimeType — `contains 'image/'` matches every image subtype
 * Drive reports (jpeg, png, heic, heif, webp, gif, ...), not just an exact
 * jpeg/png allowlist. A phone that uploads HEIC photos to Drive (the default on
 * iPhone) would otherwise never even show up as a *candidate* file here, silently
 * producing "0 imported" with no explanation. Letting every image type through as a
 * candidate and relying on uploadPhotoBatch's own sniffImageType() to accept/reject
 * (HEIC is explicitly rejected there with a clear, visible reason) is what actually
 * surfaces the problem to the admin instead of hiding it.
 */
export async function listNewImagesInFolder(drive: drive_v3.Drive, folderId: string, sinceIso?: string): Promise<DriveImageFile[]> {
  const clauses = [`'${folderId}' in parents`, 'trashed = false', "mimeType contains 'image/'"]
  if (sinceIso) clauses.push(`modifiedTime > '${sinceIso}'`)

  const files: DriveImageFile[] = []
  let pageToken: string | undefined
  do {
    const res = await drive.files.list({
      q: clauses.join(' and '),
      fields: 'nextPageToken, files(id, name, mimeType, modifiedTime)',
      pageSize: 100,
      pageToken,
      orderBy: 'modifiedTime',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    })
    for (const f of res.data.files ?? []) {
      if (f.id && f.name && f.mimeType && f.modifiedTime) {
        files.push({ id: f.id, name: f.name, mimeType: f.mimeType, modifiedTime: f.modifiedTime })
      }
    }
    pageToken = res.data.nextPageToken ?? undefined
  } while (pageToken)

  return files
}

export async function downloadDriveFile(drive: drive_v3.Drive, fileId: string): Promise<Buffer> {
  const res = await drive.files.get({ fileId, alt: 'media', supportsAllDrives: true }, { responseType: 'arraybuffer' })
  return Buffer.from(res.data as ArrayBuffer)
}
