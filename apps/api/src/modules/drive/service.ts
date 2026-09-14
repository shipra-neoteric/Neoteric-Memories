import { getPrisma } from '../../db.js'
import { Errors } from '../../lib/errors.js'
import { encryptSecret } from '../../lib/tokenCrypto.js'
import { signOAuthState, verifyOAuthState } from '../../lib/oauthState.js'
import { isTestRuntime } from '../../lib/testGuard.js'
import { writeAuditLog } from '../audit/service.js'
import { uploadPhotoBatch } from '../photos/service.js'
import {
  buildGoogleConsentUrl,
  downloadDriveFile,
  driveClientForRefreshTokenEnc,
  exchangeCodeForRefreshToken,
  extractFolderId,
  getFolderName,
  isDriveIntegrationConfigured,
  listNewImagesInFolder,
} from '../../providers/drive/googleDriveClient.js'
import { logger } from '../../lib/logger.js'

export { isDriveIntegrationConfigured }

export async function startConnect(eventId: string, actor: { id: string }): Promise<string> {
  const prisma = getPrisma()
  const event = await prisma.event.findUnique({ where: { id: eventId } })
  if (!event || event.deletedAt) throw Errors.notFound('Event not found')
  return buildGoogleConsentUrl(signOAuthState(eventId, actor.id))
}

export async function handleOAuthCallback(code: string, state: string, actor: { id: string; role: string }): Promise<{ eventId: string }> {
  const { eventId } = verifyOAuthState(state, actor.id)
  const { refreshToken, email } = await exchangeCodeForRefreshToken(code)

  const prisma = getPrisma()
  await prisma.driveIntegration.upsert({
    where: { eventId },
    create: {
      eventId,
      connectedById: actor.id,
      googleAccountEmail: email,
      refreshTokenEnc: encryptSecret(refreshToken),
      status: 'PENDING_FOLDER',
    },
    update: {
      connectedById: actor.id,
      googleAccountEmail: email,
      refreshTokenEnc: encryptSecret(refreshToken),
      status: 'PENDING_FOLDER',
      lastError: null,
    },
  })

  await writeAuditLog({ actorId: actor.id, actorRole: actor.role, action: 'drive.connected', entityType: 'Event', entityId: eventId, eventId, metadata: { email } })
  return { eventId }
}

export async function setFolder(eventId: string, folderInput: string, actor: { id: string; role: string }) {
  const prisma = getPrisma()
  const integration = await prisma.driveIntegration.findUnique({ where: { eventId } })
  if (!integration) throw Errors.notFound('Connect Google Drive for this event first')

  const folderId = extractFolderId(folderInput)
  const drive = driveClientForRefreshTokenEnc(integration.refreshTokenEnc)
  const folderName = await getFolderName(drive, folderId) // throws a clear error if inaccessible or not a folder

  const updated = await prisma.driveIntegration.update({
    where: { eventId },
    data: { folderId, folderName, status: 'ACTIVE', lastError: null },
  })
  await writeAuditLog({ actorId: actor.id, actorRole: actor.role, action: 'drive.folder_set', entityType: 'Event', entityId: eventId, eventId, metadata: { folderId, folderName } })
  return updated
}

export async function disconnect(eventId: string, actor: { id: string; role: string }): Promise<void> {
  const prisma = getPrisma()
  await prisma.driveIntegration.deleteMany({ where: { eventId } })
  await writeAuditLog({ actorId: actor.id, actorRole: actor.role, action: 'drive.disconnected', entityType: 'Event', entityId: eventId, eventId })
}

export async function pauseOrResume(eventId: string, active: boolean, actor: { id: string; role: string }) {
  const prisma = getPrisma()
  const integration = await prisma.driveIntegration.findUnique({ where: { eventId } })
  if (!integration || !integration.folderId) throw Errors.notFound('No active Drive folder connection for this event')
  const updated = await prisma.driveIntegration.update({ where: { eventId }, data: { status: active ? 'ACTIVE' : 'PAUSED' } })
  await writeAuditLog({ actorId: actor.id, actorRole: actor.role, action: active ? 'drive.resumed' : 'drive.paused', entityType: 'Event', entityId: eventId, eventId })
  return updated
}

// Downloading every new file with one big Promise.all() held every file's full bytes
// in memory simultaneously — for a large folder that's enough to exhaust the
// process's memory on a constrained instance, killing/restarting it partway through
// and silently leaving only however many files had already reached uploadPhotoBatch
// by then (with no error ever surfacing, since the crash isn't a clean rejection).
// Downloading (and uploading) in small chunks bounds peak memory to one chunk's
// worth of files, regardless of how many hundreds are in the folder.
const DRIVE_SYNC_CHUNK_SIZE = 10

// HEIC decoding (heicConvert.ts) runs a WASM codec on the main thread — each call
// blocks Node's single event loop for however long that one image takes. A folder
// with hundreds of HEIC files processed in one sync run can keep the WHOLE server
// (every unrelated request, not just this one) starved for minutes, which is exactly
// what took the entire admin panel down in production once. Capping how many files
// one sync *run* will touch bounds the worst case regardless of folder size — the
// rest gets picked up by the next scheduled run (every DRIVE_SYNC_INTERVAL_MINUTES),
// so a big backlog drains gradually instead of overloading the server in one shot.
// lastSyncedAt only advances once a run actually clears the whole backlog it found;
// otherwise the next run re-lists it, safely re-skipping already-imported files via
// uploadPhotoBatch's fileHash dedupe, and makes further progress.
const MAX_FILES_PER_SYNC_RUN = 30

/** Imports every new image in one connected folder since the last sync, through the exact same validation/dedupe/processing pipeline as a manual upload. */
export async function syncOneIntegration(integration: {
  id: string
  eventId: string
  folderId: string | null
  refreshTokenEnc: string
  lastSyncedAt: Date | null
  connectedById: string
}): Promise<{ imported: number; summary: string }> {
  if (!integration.folderId) return { imported: 0, summary: 'This integration has no folder configured yet.' }
  const prisma = getPrisma()
  const drive = driveClientForRefreshTokenEnc(integration.refreshTokenEnc)
  const sinceIso = integration.lastSyncedAt?.toISOString()
  const newFiles = await listNewImagesInFolder(drive, integration.folderId, sinceIso)

  if (newFiles.length === 0) {
    const summary = 'No new files found in the Drive folder since the last sync.'
    await prisma.driveIntegration.update({ where: { id: integration.id }, data: { lastSyncedAt: new Date(), lastError: null, lastSyncSummary: summary } })
    return { imported: 0, summary }
  }

  const filesToProcess = newFiles.slice(0, MAX_FILES_PER_SYNC_RUN)
  const remaining = newFiles.length - filesToProcess.length

  let accepted = 0
  let duplicates = 0
  const rejectedReasons = new Map<string, number>() // reason -> count, so a repeated cause (e.g. HEIC) collapses to one line instead of one per file
  const actor = { id: integration.connectedById, role: 'EVENT_MANAGER' }

  for (let i = 0; i < filesToProcess.length; i += DRIVE_SYNC_CHUNK_SIZE) {
    const chunk = filesToProcess.slice(i, i + DRIVE_SYNC_CHUNK_SIZE)
    const downloaded = await Promise.all(
      chunk.map(async (f) => ({
        buffer: await downloadDriveFile(drive, f.id),
        originalFilename: f.name,
        declaredMimeType: f.mimeType,
      }))
    )
    const outcome = await uploadPhotoBatch(integration.eventId, downloaded, actor)
    accepted += outcome.accepted.length
    duplicates += outcome.duplicates.length
    for (const r of outcome.rejected) rejectedReasons.set(r.reason, (rejectedReasons.get(r.reason) ?? 0) + 1)
  }

  const rejectedTotal = [...rejectedReasons.values()].reduce((a, b) => a + b, 0)
  const summaryParts = [`${newFiles.length} found`, `${accepted} imported`]
  if (duplicates > 0) summaryParts.push(`${duplicates} already imported`)
  if (rejectedTotal > 0) summaryParts.push(`${rejectedTotal} rejected (${[...rejectedReasons.keys()].join('; ')})`)
  if (remaining > 0) summaryParts.push(`${remaining} more queued for the next sync (processing this many at once could overload the server)`)
  const summary = summaryParts.join(' · ')

  await prisma.driveIntegration.update({
    where: { id: integration.id },
    data: {
      // Only advance past this run's files if there's nothing left over — otherwise
      // the next run must re-list the same window to pick up what didn't fit here.
      lastSyncedAt: remaining > 0 ? integration.lastSyncedAt ?? undefined : new Date(),
      importedCount: { increment: accepted },
      lastError: null,
      lastSyncSummary: summary,
    },
  })
  logger.info({ eventId: integration.eventId, accepted, duplicates, rejected: rejectedTotal, remaining }, 'Drive sync imported photos')
  return { imported: accepted, summary }
}

export async function runDriveSyncSweep(): Promise<{ integrationsSynced: number; photosImported: number }> {
  // Belt-and-suspenders: even if something schedules this under the test runtime,
  // never reach out to real Google Drive accounts — no-op instead.
  if (isTestRuntime()) return { integrationsSynced: 0, photosImported: 0 }
  const prisma = getPrisma()
  const integrations = await prisma.driveIntegration.findMany({ where: { status: 'ACTIVE', folderId: { not: null } } })

  let photosImported = 0
  for (const integration of integrations) {
    try {
      const { imported } = await syncOneIntegration(integration)
      photosImported += imported
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.error({ eventId: integration.eventId }, `Drive sync failed: ${message}`)
      await prisma.driveIntegration.update({ where: { id: integration.id }, data: { status: 'ERROR', lastError: message } })
    }
  }
  return { integrationsSynced: integrations.length, photosImported }
}
