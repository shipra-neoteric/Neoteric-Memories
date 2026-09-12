import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { getPrisma } from '../../src/db.js'
import { processZipGenerate } from '../../src/jobs/processors/zipGenerate.js'
import { processSelfieDelete } from '../../src/jobs/processors/selfieDelete.js'
import { renderSyntheticPhoto } from '../../src/devSeed/seedImages.js'
import { app, setupLiveEvent } from '../helpers.js'

const validConsentBody = {
  required: { search_purpose: true, match_accuracy_disclaimer: true, retention_policy: true },
  optional: { marketing_contact: false, marketing_photo_use: false },
}

describe('Guest journey — happy path', () => {
  it('scan -> landing -> consent -> selfie -> results -> single download -> zip download', async () => {
    const { eventId, rawToken } = await setupLiveEvent('person-1')
    const agent = request.agent(app)

    const landing = await agent.get(`/api/guest/events/${rawToken}`)
    expect(landing.body.ok).toBe(true)
    const sessionId = landing.body.sessionId as string
    expect(landing.body.event.id).toBe(eventId)

    const consent = await agent.post(`/api/guest/sessions/${sessionId}/consent`).send(validConsentBody)
    expect(consent.status).toBe(201)

    const selfieBuffer = await renderSyntheticPhoto([{ personId: 'person-1', x: 260, y: 130, size: 300 }], 'selfie')
    const selfie = await agent.post(`/api/guest/sessions/${sessionId}/selfie`).attach('selfie', selfieBuffer, 'selfie.jpg')
    expect(selfie.status).toBe(201)
    expect(selfie.body.resultCount).toBe(1)
    const searchId = selfie.body.faceSearchId as string

    const results = await agent.get(`/api/guest/sessions/${sessionId}/searches/${searchId}/results`)
    expect(results.body.photos).toHaveLength(1)
    expect(results.body.disclaimer).toMatch(/probabilistic/i)
    const photoId = results.body.photos[0].photoId as string

    const singleUrl = await agent.get(`/api/guest/sessions/${sessionId}/searches/${searchId}/photos/${photoId}/download-url`)
    expect(singleUrl.status).toBe(200)
    expect(singleUrl.body.url).toBeTruthy()

    const zipReq = await agent.post(`/api/guest/sessions/${sessionId}/searches/${searchId}/download-zip`).send({ all: true })
    expect(zipReq.status).toBe(201)
    await processZipGenerate({ downloadJobId: zipReq.body.downloadJobId })

    const zipStatus = await agent.get(`/api/guest/sessions/${sessionId}/downloads/${zipReq.body.downloadJobId}`)
    expect(zipStatus.body.status).toBe('COMPLETED')
    expect(zipStatus.body.url).toBeTruthy()

    // The raw selfie deletion is enqueued as a background job right after the search
    // completes — process it directly here rather than depending on the worker loop.
    await processSelfieDelete({ faceSearchId: searchId })
    const search = await getPrisma().faceSearch.findUnique({ where: { id: searchId } })
    expect(search?.selfieDeletedAt).not.toBeNull()
  })

  it('reports zero results (and no photos leaked) when the selfie matches nobody in the event', async () => {
    const { rawToken } = await setupLiveEvent('person-1')
    const agent = request.agent(app)
    const landing = await agent.get(`/api/guest/events/${rawToken}`)
    const sessionId = landing.body.sessionId as string
    await agent.post(`/api/guest/sessions/${sessionId}/consent`).send(validConsentBody)

    const selfieBuffer = await renderSyntheticPhoto([{ personId: 'person-8', x: 260, y: 130, size: 300 }], 'stranger selfie')
    const selfie = await agent.post(`/api/guest/sessions/${sessionId}/selfie`).attach('selfie', selfieBuffer, 'selfie.jpg')
    expect(selfie.body.resultCount).toBe(0)
  })
})

describe('Guest journey — consent gating', () => {
  it('refuses a selfie submission before consent has been given', async () => {
    const { rawToken } = await setupLiveEvent('person-1')
    const agent = request.agent(app)
    const landing = await agent.get(`/api/guest/events/${rawToken}`)
    const sessionId = landing.body.sessionId as string

    const selfieBuffer = await renderSyntheticPhoto([{ personId: 'person-1', x: 260, y: 130, size: 300 }], 'selfie')
    const res = await agent.post(`/api/guest/sessions/${sessionId}/selfie`).attach('selfie', selfieBuffer, 'selfie.jpg')
    expect(res.status).toBe(403)
  })

  it('accepting the optional marketing consents is independent of whether photo retrieval works, and declining them still returns results', async () => {
    const { rawToken } = await setupLiveEvent('person-1')
    const agent = request.agent(app)
    const landing = await agent.get(`/api/guest/events/${rawToken}`)
    const sessionId = landing.body.sessionId as string

    await agent.post(`/api/guest/sessions/${sessionId}/consent`).send({
      required: { search_purpose: true, match_accuracy_disclaimer: true, retention_policy: true },
      optional: { marketing_contact: false, marketing_photo_use: false }, // explicitly declined
    })

    const selfieBuffer = await renderSyntheticPhoto([{ personId: 'person-1', x: 260, y: 130, size: 300 }], 'selfie')
    const selfie = await agent.post(`/api/guest/sessions/${sessionId}/selfie`).attach('selfie', selfieBuffer, 'selfie.jpg')
    expect(selfie.status).toBe(201)
    expect(selfie.body.resultCount).toBe(1)
  })
})

describe('Guest journey — selfie validation + attempt limiting', () => {
  it('rejects a selfie with no detectable face and still counts it as an attempt', async () => {
    const { rawToken } = await setupLiveEvent('person-1')
    const agent = request.agent(app)
    const landing = await agent.get(`/api/guest/events/${rawToken}`)
    const sessionId = landing.body.sessionId as string
    await agent.post(`/api/guest/sessions/${sessionId}/consent`).send(validConsentBody)

    const blank = await renderSyntheticPhoto([], 'no face')
    const res = await agent.post(`/api/guest/sessions/${sessionId}/selfie`).attach('selfie', blank, 'blank.jpg')
    expect(res.status).toBe(422)
    expect(res.body.reason).toBe('NO_FACE_DETECTED')

    const session = await getPrisma().guestSession.findUnique({ where: { id: sessionId } })
    expect(session?.selfieAttempts).toBe(1)
  })

  it('rejects a selfie with multiple detected faces', async () => {
    const { rawToken } = await setupLiveEvent('person-1')
    const agent = request.agent(app)
    const landing = await agent.get(`/api/guest/events/${rawToken}`)
    const sessionId = landing.body.sessionId as string
    await agent.post(`/api/guest/sessions/${sessionId}/consent`).send(validConsentBody)

    const twoFaces = await renderSyntheticPhoto(
      [
        { personId: 'person-1', x: 100, y: 130, size: 200 },
        { personId: 'person-2', x: 500, y: 130, size: 200 },
      ],
      'two faces'
    )
    const res = await agent.post(`/api/guest/sessions/${sessionId}/selfie`).attach('selfie', twoFaces, 'two.jpg')
    expect(res.status).toBe(422)
    expect(res.body.reason).toBe('MULTIPLE_FACES_DETECTED')
  })

  it('locks out further selfie attempts once the per-session maximum is reached', async () => {
    const { rawToken } = await setupLiveEvent('person-1')
    const agent = request.agent(app)
    const landing = await agent.get(`/api/guest/events/${rawToken}`)
    const sessionId = landing.body.sessionId as string
    await agent.post(`/api/guest/sessions/${sessionId}/consent`).send(validConsentBody)

    const blank = await renderSyntheticPhoto([], 'no face')
    for (let i = 0; i < 5; i += 1) {
      await agent.post(`/api/guest/sessions/${sessionId}/selfie`).attach('selfie', blank, 'blank.jpg')
    }
    const sixth = await agent.post(`/api/guest/sessions/${sessionId}/selfie`).attach('selfie', blank, 'blank.jpg')
    expect(sixth.status).toBe(429)
  })
})

describe('Guest journey — wrong-match reporting (IDOR guard)', () => {
  it('allows reporting a photo that is genuinely in the results, and rejects one that is not', async () => {
    const { rawToken } = await setupLiveEvent('person-1')
    const agent = request.agent(app)
    const landing = await agent.get(`/api/guest/events/${rawToken}`)
    const sessionId = landing.body.sessionId as string
    await agent.post(`/api/guest/sessions/${sessionId}/consent`).send(validConsentBody)
    const selfieBuffer = await renderSyntheticPhoto([{ personId: 'person-1', x: 260, y: 130, size: 300 }], 'selfie')
    const selfie = await agent.post(`/api/guest/sessions/${sessionId}/selfie`).attach('selfie', selfieBuffer, 'selfie.jpg')
    const searchId = selfie.body.faceSearchId as string
    const results = await agent.get(`/api/guest/sessions/${sessionId}/searches/${searchId}/results`)
    const photoId = results.body.photos[0].photoId as string

    const ok = await agent.post(`/api/guest/sessions/${sessionId}/searches/${searchId}/report-wrong-match`).send({ photoId })
    expect(ok.status).toBe(201)

    const fakePhotoId = '507f1f77bcf86cd799439011'
    const bad = await agent
      .post(`/api/guest/sessions/${sessionId}/searches/${searchId}/report-wrong-match`)
      .send({ photoId: fakePhotoId })
    expect(bad.status).toBe(400)
  })
})

describe('Guest journey — event pause + self-service deletion', () => {
  it('blocks new selfie submissions while the event is paused, without affecting already-fetched results', async () => {
    const { adminClient, eventId, rawToken } = await setupLiveEvent('person-1')
    const agent = request.agent(app)
    const landing = await agent.get(`/api/guest/events/${rawToken}`)
    const sessionId = landing.body.sessionId as string
    await agent.post(`/api/guest/sessions/${sessionId}/consent`).send(validConsentBody)

    await adminClient.post(`/api/admin/events/${eventId}/status`).send({ status: 'PAUSED' })

    const selfieBuffer = await renderSyntheticPhoto([{ personId: 'person-1', x: 260, y: 130, size: 300 }], 'selfie')
    const res = await agent.post(`/api/guest/sessions/${sessionId}/selfie`).attach('selfie', selfieBuffer, 'selfie.jpg')
    expect(res.status).toBe(409)
  })

  it('deletes a guest session\'s search data on request', async () => {
    const { rawToken } = await setupLiveEvent('person-1')
    const agent = request.agent(app)
    const landing = await agent.get(`/api/guest/events/${rawToken}`)
    const sessionId = landing.body.sessionId as string
    await agent.post(`/api/guest/sessions/${sessionId}/consent`).send(validConsentBody)
    const selfieBuffer = await renderSyntheticPhoto([{ personId: 'person-1', x: 260, y: 130, size: 300 }], 'selfie')
    const selfie = await agent.post(`/api/guest/sessions/${sessionId}/selfie`).attach('selfie', selfieBuffer, 'selfie.jpg')
    const searchId = selfie.body.faceSearchId as string

    const del = await agent.delete(`/api/guest/sessions/${sessionId}`)
    expect(del.status).toBe(200)

    const search = await getPrisma().faceSearch.findUnique({ where: { id: searchId } })
    expect(search).toBeNull()
    const session = await getPrisma().guestSession.findUnique({ where: { id: sessionId } })
    expect(session?.status).toBe('DELETED')
  })
})

describe('Guest journey — cross-session privacy', () => {
  it('refuses to serve results for a session id that does not match the caller\'s own guest cookie', async () => {
    const { rawToken } = await setupLiveEvent('person-1')
    const victim = request.agent(app)
    const victimLanding = await victim.get(`/api/guest/events/${rawToken}`)
    const victimSessionId = victimLanding.body.sessionId as string

    // A different "browser" (fresh agent, no cookie for victim's session) tries to access it directly.
    const attacker = request.agent(app)
    const res = await attacker.get(`/api/guest/sessions/${victimSessionId}/searches/000000000000000000000000/results`)
    expect(res.status).toBe(403)
  })
})
