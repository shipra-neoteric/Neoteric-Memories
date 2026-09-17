import { describe, expect, it } from 'vitest'
import { getPrisma } from '../../src/db.js'
import { encryptSecret } from '../../src/lib/tokenCrypto.js'
import { makeSite, makeUser, loginAsAgent, validEventPayload } from '../helpers.js'

describe('POST /api/admin/events/:id/drive/sync-now', () => {
  it('enqueues and immediately processes a DRIVE_SYNC job scoped to this event, synchronously in the response', async () => {
    const site = await makeSite()
    const { user, password } = await makeUser('MASTER_ADMIN')
    const client = await loginAsAgent(user.email, password)
    const created = await client.post('/api/admin/events').send(validEventPayload(site.id))
    const eventId = created.body.event.id as string

    const prisma = getPrisma()
    await prisma.driveIntegration.create({
      data: {
        eventId,
        connectedById: user.id,
        refreshTokenEnc: encryptSecret('fake-refresh-token'),
        folderId: 'fake-folder-id',
        folderName: 'Test Folder',
        status: 'ACTIVE',
      },
    })

    // The test runtime's runDriveSyncSweep() is a deliberate no-op (never reaches out
    // to real Google Drive) — this test verifies the enqueue+immediate-claim+response
    // mechanics sync-now added, not real Drive import behavior.
    const res = await client.post(`/api/admin/events/${eventId}/drive/sync-now`)
    expect(res.status).toBe(200)
    expect(res.body.processed).toBe(true)
    expect(res.body.result).toBe('completed')
    expect(res.body.integration).toBeTruthy()

    // A second click enqueues and claims its own fresh job too (a manual action, not
    // a once-per-interval scheduled tick) rather than colliding with the first.
    const res2 = await client.post(`/api/admin/events/${eventId}/drive/sync-now`)
    expect(res2.body.processed).toBe(true)
  })

  it('404s when the event has no active Drive folder connection', async () => {
    const site = await makeSite()
    const { user, password } = await makeUser('MASTER_ADMIN')
    const client = await loginAsAgent(user.email, password)
    const created = await client.post('/api/admin/events').send(validEventPayload(site.id))
    const eventId = created.body.event.id as string

    const res = await client.post(`/api/admin/events/${eventId}/drive/sync-now`)
    expect(res.status).toBe(404)
  })
})
