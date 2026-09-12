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

/** Imports every new image in one connected folder since the last sync, through the exact same validation/dedupe/processing pipeline as a manual upload. */
export async function syncOneIntegration(integration: {
  id: string
  eventId: string
  folderId: string | null
  refreshTokenEnc: string
  lastSyncedAt: Date | null
  connectedById: string
}): Promise<{ imported: number }> {
  if (!integration.folderId) return { imported: 0 }
  const prisma = getPrisma()
  const drive = driveClientForRefreshTokenEnc(integration.refreshTokenEnc)
  const sinceIso = integration.lastSyncedAt?.toISOString()
  const newFiles = await listNewImagesInFolder(drive, integration.folderId, sinceIso)

  if (newFiles.length === 0) {
    await prisma.driveIntegration.update({ where: { id: integration.id }, data: { lastSyncedAt: new Date(), lastError: null } })
    return { imported: 0 }
  }

  const downloaded = await Promise.all(
    newFiles.map(async (f) => ({
      buffer: await downloadDriveFile(drive, f.id),
      originalFilename: f.name,
      declaredMimeType: f.mimeType,
    }))
  )

  const outcome = await uploadPhotoBatch(integration.eventId, downloaded, { id: integration.connectedById, role: 'EVENT_MANAGER' })

  await prisma.driveIntegration.update({
    where: { id: integration.id },
    data: { lastSyncedAt: new Date(), importedCount: { increment: outcome.accepted.length }, lastError: null },
  })
  logger.info(
    { eventId: integration.eventId, accepted: outcome.accepted.length, duplicates: outcome.duplicates.length, rejected: outcome.rejected.length },
    'Drive sync imported photos'
  )
  return { imported: outcome.accepted.length }
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
