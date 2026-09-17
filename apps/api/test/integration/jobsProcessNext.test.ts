import { describe, expect, it } from 'vitest'
import { getPrisma } from '../../src/db.js'
import { renderSyntheticPhoto } from '../../src/devSeed/seedImages.js'
import { loginAsAgent, makeSite, makeUser, validEventPayload } from '../helpers.js'

async function createLiveableEvent() {
  const site = await makeSite()
  const { user, password } = await makeUser('MASTER_ADMIN')
  const client = await loginAsAgent(user.email, password)
  const created = await client.post('/api/admin/events').send(validEventPayload(site.id))
  return { client, eventId: created.body.event.id as string }
}

describe('POST /api/admin/events/:id/jobs/process-next', () => {
  it('claims and runs the queued photo job for this batch, reporting completion and an empty remaining count', async () => {
    const { client, eventId } = await createLiveableEvent()
    const buffer = await renderSyntheticPhoto([{ personId: 'person-1', x: 200, y: 100, size: 200 }], 'test photo')
    const upload = await client.post(`/api/admin/events/${eventId}/photos`).attach('photos', buffer, 'a.jpg')
    const photoId = upload.body.accepted[0].photoId as string
    const batchId = upload.body.batchId as string
    expect(batchId).toBeTruthy()

    const res = await client.post(`/api/admin/events/${eventId}/jobs/process-next`).send({ batchId })
    expect(res.status).toBe(200)
    expect(res.body.processed).toBe(true)
    expect(res.body.jobType).toBe('PHOTO_PROCESS')
    expect(res.body.result).toBe('completed')
    expect(res.body.remainingForBatch).toBe(0)

    const photo = await getPrisma().photo.findUnique({ where: { id: photoId } })
    expect(photo?.status).toBe('PROCESSED')
  })

  it('reports nothing_to_process once the batch is fully drained', async () => {
    const { client, eventId } = await createLiveableEvent()
    const buffer = await renderSyntheticPhoto([], 'no faces')
    const upload = await client.post(`/api/admin/events/${eventId}/photos`).attach('photos', buffer, 'b.jpg')
    const batchId = upload.body.batchId as string

    await client.post(`/api/admin/events/${eventId}/jobs/process-next`).send({ batchId })
    const second = await client.post(`/api/admin/events/${eventId}/jobs/process-next`).send({ batchId })
    expect(second.body.processed).toBe(false)
    expect(second.body.result).toBe('nothing_to_process')
  })

  it('never processes another event\'s job even when both are queued at the same time', async () => {
    const { client: clientA, eventId: eventA } = await createLiveableEvent()
    const { client: clientB, eventId: eventB } = await createLiveableEvent()
    const bufferA = await renderSyntheticPhoto([{ personId: 'person-2', x: 200, y: 100, size: 200 }], 'photo A')
    const bufferB = await renderSyntheticPhoto([{ personId: 'person-3', x: 200, y: 100, size: 200 }], 'photo B')
    const uploadA = await clientA.post(`/api/admin/events/${eventA}/photos`).attach('photos', bufferA, 'a.jpg')
    const uploadB = await clientB.post(`/api/admin/events/${eventB}/photos`).attach('photos', bufferB, 'b.jpg')
    const batchA = uploadA.body.batchId as string
    const photoIdB = uploadB.body.accepted[0].photoId as string

    // Draining event A's batch must never touch event B's still-queued job, no
    // matter how many times it's called — this is the scoping guarantee, not just an
    // ordering coincidence.
    for (let i = 0; i < 3; i++) {
      await clientA.post(`/api/admin/events/${eventA}/jobs/process-next`).send({ batchId: batchA })
    }

    const photoB = await getPrisma().photo.findUnique({ where: { id: photoIdB } })
    expect(photoB?.status).toBe('PENDING') // untouched — still queued, not claimed by event A's calls

    const resB = await clientB.post(`/api/admin/events/${eventB}/jobs/process-next`).send({})
    expect(resB.body.processed).toBe(true)
    const photoBAfter = await getPrisma().photo.findUnique({ where: { id: photoIdB } })
    expect(photoBAfter?.status).toBe('PROCESSED')
  })

  it('concurrent calls for the same batch never process the same job twice', async () => {
    const { client, eventId } = await createLiveableEvent()
    const buffer = await renderSyntheticPhoto([{ personId: 'person-1', x: 200, y: 100, size: 200 }], 'concurrency test')
    const upload = await client.post(`/api/admin/events/${eventId}/photos`).attach('photos', buffer, 'c.jpg')
    const batchId = upload.body.batchId as string

    const [first, second] = await Promise.all([
      client.post(`/api/admin/events/${eventId}/jobs/process-next`).send({ batchId }),
      client.post(`/api/admin/events/${eventId}/jobs/process-next`).send({ batchId }),
    ])
    const processedCount = [first, second].filter((r) => r.body.processed).length
    expect(processedCount).toBe(1) // exactly one call claimed the single queued job; the other found nothing left
  })

  it('denies a user without photo:upload permission', async () => {
    const { eventId } = await createLiveableEvent()
    const { user: admin, password: adminPw } = await makeUser('MASTER_ADMIN')
    const adminClient = await loginAsAgent(admin.email, adminPw)
    const { user: support, password: supportPw } = await makeUser('SUPPORT_EXECUTIVE')
    await adminClient.post(`/api/admin/events/${eventId}/assignments`).send({ userId: support.id, role: 'PHOTOGRAPHER' })
    const supportClient = await loginAsAgent(support.email, supportPw)

    const res = await supportClient.post(`/api/admin/events/${eventId}/jobs/process-next`).send({})
    expect(res.status).toBe(403)
  })
})

