import { describe, expect, it } from 'vitest'
import { getPrisma } from '../../src/db.js'
import { processPhotoProcess } from '../../src/jobs/processors/photoProcess.js'
import { renderSyntheticPhoto } from '../../src/devSeed/seedImages.js'
import { app, loginAsAgent, makeSite, makeUser, validEventPayload, waitForPhotoReady } from '../helpers.js'

async function createLiveableEvent() {
  const site = await makeSite()
  const { user, password } = await makeUser('MASTER_ADMIN')
  const client = await loginAsAgent(user.email, password)
  const created = await client.post('/api/admin/events').send(validEventPayload(site.id))
  return { client, eventId: created.body.event.id as string }
}

describe('Photo upload + processing', () => {
  it('uploads a photo, processes it, and indexes one detected face', async () => {
    const { client, eventId } = await createLiveableEvent()
    const buffer = await renderSyntheticPhoto([{ personId: 'person-1', x: 200, y: 100, size: 200 }], 'test photo')

    const res = await client.post(`/api/admin/events/${eventId}/photos`).attach('photos', buffer, 'photo1.jpg')
    expect(res.status).toBe(202)
    expect(res.body.queued).toBe(1)

    const photoId = await waitForPhotoReady(eventId, 'photo1.jpg')
    await processPhotoProcess({ photoId })

    const photo = await getPrisma().photo.findUnique({ where: { id: photoId } })
    expect(photo?.status).toBe('PROCESSED')
    expect(photo?.faceCount).toBe(1)

    const faces = await getPrisma().indexedFace.findMany({ where: { photoId } })
    expect(faces).toHaveLength(1)
  })

  it('flags a photo with no detected faces as NO_FACES rather than failing the batch', async () => {
    const { client, eventId } = await createLiveableEvent()
    const buffer = await renderSyntheticPhoto([], 'empty photo')
    await client.post(`/api/admin/events/${eventId}/photos`).attach('photos', buffer, 'empty.jpg')
    const photoId = await waitForPhotoReady(eventId, 'empty.jpg')
    await processPhotoProcess({ photoId })
    const photo = await getPrisma().photo.findUnique({ where: { id: photoId } })
    expect(photo?.status).toBe('NO_FACES')
    expect(photo?.faceCount).toBe(0)
  })

  it('detects a duplicate upload by content hash and does not create a second photo', async () => {
    const { client, eventId } = await createLiveableEvent()
    const buffer = await renderSyntheticPhoto([{ personId: 'person-2', x: 150, y: 120, size: 180 }], 'dup test')

    const first = await client.post(`/api/admin/events/${eventId}/photos`).attach('photos', buffer, 'a.jpg')
    expect(first.body.queued).toBe(1)
    await waitForPhotoReady(eventId, 'a.jpg')

    const second = await client.post(`/api/admin/events/${eventId}/photos`).attach('photos', buffer, 'a-retry.jpg')
    expect(second.body.queued).toBe(0)
    expect(second.body.duplicates).toHaveLength(1)

    const count = await getPrisma().photo.count({ where: { eventId } })
    expect(count).toBe(1)
  })

  it('reprocessing the same photo (idempotent retry) does not double the indexed face count', async () => {
    const { client, eventId } = await createLiveableEvent()
    const buffer = await renderSyntheticPhoto([{ personId: 'person-3', x: 150, y: 120, size: 180 }], 'idempotent test')
    await client.post(`/api/admin/events/${eventId}/photos`).attach('photos', buffer, 'idem.jpg')
    const photoId = await waitForPhotoReady(eventId, 'idem.jpg')

    await processPhotoProcess({ photoId })
    await processPhotoProcess({ photoId }) // simulate a retried/duplicated job

    const faces = await getPrisma().indexedFace.findMany({ where: { photoId } })
    expect(faces).toHaveLength(1)
  })

  it('rejects a file that is not a valid image', async () => {
    const { client, eventId } = await createLiveableEvent()
    const res = await client
      .post(`/api/admin/events/${eventId}/photos`)
      .attach('photos', Buffer.from('this is not an image'), 'notreal.jpg')
    expect(res.status).toBe(202)
    expect(res.body.queued).toBe(0)
    expect(res.body.rejected).toHaveLength(1)
  })

  it('a deleted photo is excluded from further admin listing and its indexed faces are removed', async () => {
    const { client, eventId } = await createLiveableEvent()
    const buffer = await renderSyntheticPhoto([{ personId: 'person-4', x: 150, y: 120, size: 180 }], 'delete test')
    await client.post(`/api/admin/events/${eventId}/photos`).attach('photos', buffer, 'del.jpg')
    const photoId = await waitForPhotoReady(eventId, 'del.jpg')
    await processPhotoProcess({ photoId })

    const del = await client.delete(`/api/admin/events/${eventId}/photos/${photoId}`)
    expect(del.status).toBe(200)

    const faces = await getPrisma().indexedFace.findMany({ where: { photoId } })
    expect(faces).toHaveLength(0)

    const list = await client.get(`/api/admin/events/${eventId}/photos`)
    expect(list.body.photos.find((p: { id: string }) => p.id === photoId)).toBeUndefined()
  })
})
