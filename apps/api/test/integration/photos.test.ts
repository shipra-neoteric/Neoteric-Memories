import { describe, expect, it } from 'vitest'
import { getPrisma } from '../../src/db.js'
import { processPhotoProcess } from '../../src/jobs/processors/photoProcess.js'
import { renderSyntheticPhoto } from '../../src/devSeed/seedImages.js'
import { app, loginAsAgent, makeSite, makeUser, validEventPayload } from '../helpers.js'

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
    expect(res.status).toBe(201)
    expect(res.body.accepted).toHaveLength(1)

    const photoId = res.body.accepted[0].photoId as string
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
    const res = await client.post(`/api/admin/events/${eventId}/photos`).attach('photos', buffer, 'empty.jpg')
    const photoId = res.body.accepted[0].photoId as string
    await processPhotoProcess({ photoId })
    const photo = await getPrisma().photo.findUnique({ where: { id: photoId } })
    expect(photo?.status).toBe('NO_FACES')
    expect(photo?.faceCount).toBe(0)
  })

  it('detects a duplicate upload by content hash and does not create a second photo', async () => {
    const { client, eventId } = await createLiveableEvent()
    const buffer = await renderSyntheticPhoto([{ personId: 'person-2', x: 150, y: 120, size: 180 }], 'dup test')

    const first = await client.post(`/api/admin/events/${eventId}/photos`).attach('photos', buffer, 'a.jpg')
    expect(first.body.accepted).toHaveLength(1)

    const second = await client.post(`/api/admin/events/${eventId}/photos`).attach('photos', buffer, 'a-retry.jpg')
    expect(second.body.accepted).toHaveLength(0)
    expect(second.body.duplicates).toHaveLength(1)

    const count = await getPrisma().photo.count({ where: { eventId } })
    expect(count).toBe(1)
  })

  it('reprocessing the same photo (idempotent retry) does not double the indexed face count', async () => {
    const { client, eventId } = await createLiveableEvent()
    const buffer = await renderSyntheticPhoto([{ personId: 'person-3', x: 150, y: 120, size: 180 }], 'idempotent test')
    const res = await client.post(`/api/admin/events/${eventId}/photos`).attach('photos', buffer, 'idem.jpg')
    const photoId = res.body.accepted[0].photoId as string

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
    expect(res.status).toBe(201)
    expect(res.body.accepted).toHaveLength(0)
    expect(res.body.rejected).toHaveLength(1)
  })

  it('a deleted photo is excluded from further admin listing and its indexed faces are removed', async () => {
    const { client, eventId } = await createLiveableEvent()
    const buffer = await renderSyntheticPhoto([{ personId: 'person-4', x: 150, y: 120, size: 180 }], 'delete test')
    const res = await client.post(`/api/admin/events/${eventId}/photos`).attach('photos', buffer, 'del.jpg')
    const photoId = res.body.accepted[0].photoId as string
    await processPhotoProcess({ photoId })

    const del = await client.delete(`/api/admin/events/${eventId}/photos/${photoId}`)
    expect(del.status).toBe(200)

    const faces = await getPrisma().indexedFace.findMany({ where: { photoId } })
    expect(faces).toHaveLength(0)

    const list = await client.get(`/api/admin/events/${eventId}/photos`)
    expect(list.body.photos.find((p: { id: string }) => p.id === photoId)).toBeUndefined()
  })

  it('uploads a HEIC photo, stages it as-is, and processes it via the deferred conversion job', async () => {
    const { client, eventId } = await createLiveableEvent()
    // Minimal valid HEIC magic bytes (ftyp box with a heic brand) — see
    // lib/fileValidation.ts's sniffImageType for what it checks.
    const heicHeader = Buffer.concat([
      Buffer.from([0x00, 0x00, 0x00, 0x18]),
      Buffer.from('ftyp', 'ascii'),
      Buffer.from('heic', 'ascii'),
      Buffer.alloc(8),
    ])

    const res = await client.post(`/api/admin/events/${eventId}/photos`).attach('photos', heicHeader, 'photo.heic')
    expect(res.status).toBe(201)
    expect(res.body.accepted).toHaveLength(1)

    const photoId = res.body.accepted[0].photoId as string
    const staged = await getPrisma().photo.findUnique({ where: { id: photoId } })
    expect(staged?.status).toBe('PENDING')
    expect(staged?.mimeType).toBe('image/heic')
    expect(staged?.originalKey).toMatch(/\.heic$/)

    const job = await getPrisma().backgroundJob.findFirst({ where: { type: 'PHOTO_HEIC_CONVERT', idempotencyKey: `heic-convert:${photoId}` } })
    expect(job).toBeTruthy()
  })
})

describe('DELETE /api/admin/events/:id/photos (bulk delete)', () => {
  it('deletes every photo in the event, including their indexed faces, and leaves the event photo-free', async () => {
    const { client, eventId } = await createLiveableEvent()
    const bufferA = await renderSyntheticPhoto([{ personId: 'person-1', x: 200, y: 100, size: 200 }], 'a')
    const bufferB = await renderSyntheticPhoto([{ personId: 'person-2', x: 150, y: 120, size: 180 }], 'b')
    const resA = await client.post(`/api/admin/events/${eventId}/photos`).attach('photos', bufferA, 'a.jpg')
    const resB = await client.post(`/api/admin/events/${eventId}/photos`).attach('photos', bufferB, 'b.jpg')
    const photoIdA = resA.body.accepted[0].photoId as string
    const photoIdB = resB.body.accepted[0].photoId as string
    await processPhotoProcess({ photoId: photoIdA })
    await processPhotoProcess({ photoId: photoIdB })
    expect(await getPrisma().indexedFace.count({ where: { eventId } })).toBe(2)

    const del = await client.delete(`/api/admin/events/${eventId}/photos`)
    expect(del.status).toBe(200)
    expect(del.body.deleted).toBe(2)

    expect(await getPrisma().indexedFace.count({ where: { eventId } })).toBe(0)
    const list = await client.get(`/api/admin/events/${eventId}/photos`)
    expect(list.body.photos).toHaveLength(0)

    // Idempotent — nothing left to delete on a repeat call, not an error.
    const del2 = await client.delete(`/api/admin/events/${eventId}/photos`)
    expect(del2.body.deleted).toBe(0)
  })
})
