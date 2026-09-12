import { describe, expect, it } from 'vitest'
import { getPrisma } from '../../src/db.js'
import { runRetentionSweep } from '../../src/jobs/processors/retentionSweep.js'
import { processEventCollectionDelete } from '../../src/jobs/processors/eventCollectionDelete.js'
import { getStorageProvider } from '../../src/providers/storage/index.js'
import { MockFaceSearchProvider } from '../../src/providers/faceSearch/MockFaceSearchProvider.js'
import { renderSyntheticPhoto } from '../../src/devSeed/seedImages.js'
import { setupLiveEvent } from '../helpers.js'

const FAKE_PHOTO_ID = '507f1f77bcf86cd799439099' // MockFaceIndexEntry.photoId is typed as a Mongo ObjectId (24 hex chars)

describe('Retention sweep', () => {
  it('expires a guest session past its expiresAt', async () => {
    const { eventId } = await setupLiveEvent('person-1')
    const session = await getPrisma().guestSession.create({
      data: { eventId, ipHash: 'x', deviceHash: 'y', expiresAt: new Date(Date.now() - 1000) },
    })
    const result = await runRetentionSweep()
    expect(result.guestSessionsExpired).toBeGreaterThanOrEqual(1)
    const refreshed = await getPrisma().guestSession.findUnique({ where: { id: session.id } })
    expect(refreshed?.status).toBe('EXPIRED')
  })

  it('force-deletes a selfie that somehow survived past the max retention window and logs a security event', async () => {
    const { eventId } = await setupLiveEvent('person-1')
    const search = await getPrisma().faceSearch.create({
      data: {
        eventId,
        guestSessionId: (await getPrisma().guestSession.create({ data: { eventId, ipHash: 'x', deviceHash: 'y', expiresAt: new Date(Date.now() + 100000) } })).id,
        status: 'COMPLETED',
        createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000), // 25h ago — past the 24h hard cap
        completedAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
        selfieDeletedAt: null, // must be explicit — see the same fix/reasoning in selfieSearch.ts
      },
    })

    const result = await runRetentionSweep()
    expect(result.selfiesForceDeleted).toBeGreaterThanOrEqual(1)

    const refreshed = await getPrisma().faceSearch.findUnique({ where: { id: search.id } })
    expect(refreshed?.selfieDeletedAt).not.toBeNull()

    const securityEvents = await getPrisma().securityEvent.findMany({
      where: { eventId, type: 'SUSPICIOUS_ACTIVITY' },
    })
    expect(securityEvents.length).toBeGreaterThanOrEqual(1)
  })

  it('deletes an event\'s face index once faceIndexDeleteAt has passed', async () => {
    const { eventId } = await setupLiveEvent('person-1')
    const provider = new MockFaceSearchProvider()
    await provider.indexPhotoFaces({
      eventId,
      photoId: FAKE_PHOTO_ID,
      imageBuffer: await renderSyntheticPhoto([{ personId: 'person-5', x: 200, y: 100, size: 200 }], 'x'),
    })
    expect((await provider.getProcessingStatus({ eventId })).indexedFaceCount).toBeGreaterThan(0)

    await getPrisma().event.update({ where: { id: eventId }, data: { faceIndexDeleteAt: new Date(Date.now() - 1000) } })
    const result = await runRetentionSweep()
    expect(result.eventCollectionsQueuedForDeletion).toBeGreaterThanOrEqual(1)

    await processEventCollectionDelete({ eventId })
    expect((await provider.getProcessingStatus({ eventId })).indexedFaceCount).toBe(0)
    const event = await getPrisma().event.findUnique({ where: { id: eventId } })
    expect(event?.faceCollectionReady).toBe(false)
  })

  it('auto-expires a LIVE event once guestAccessExpiresAt has passed', async () => {
    const { eventId } = await setupLiveEvent('person-1')
    await getPrisma().event.update({ where: { id: eventId }, data: { guestAccessExpiresAt: new Date(Date.now() - 1000) } })
    await runRetentionSweep()
    const event = await getPrisma().event.findUnique({ where: { id: eventId } })
    expect(event?.status).toBe('EXPIRED')
  })

  it('cleans up an expired ZIP download job and its stored file', async () => {
    const { eventId } = await setupLiveEvent('person-1')
    const storage = getStorageProvider()
    const zipKey = `events/${eventId}/downloads/retention-test.zip`
    await storage.putObject({ key: zipKey, body: Buffer.from('fake zip'), contentType: 'application/zip' })

    const session = await getPrisma().guestSession.create({ data: { eventId, ipHash: 'x', deviceHash: 'y', expiresAt: new Date(Date.now() + 100000) } })
    const job = await getPrisma().downloadJob.create({
      data: {
        guestSessionId: session.id,
        photoIds: [],
        type: 'ZIP',
        status: 'COMPLETED',
        zipKey,
        signedUrlExpiresAt: new Date(Date.now() - 1000),
      },
    })

    await runRetentionSweep()
    const refreshed = await getPrisma().downloadJob.findUnique({ where: { id: job.id } })
    expect(refreshed?.status).toBe('EXPIRED')
    expect(await storage.objectExists(zipKey)).toBe(false)
  })
})
