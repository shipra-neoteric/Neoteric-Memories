import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { renderSyntheticPhoto } from '../../src/devSeed/seedImages.js'
import { app, setupLiveEvent } from '../helpers.js'

const validConsentBody = {
  required: { search_purpose: true, match_accuracy_disclaimer: true, retention_policy: true },
  optional: { marketing_contact: false, marketing_photo_use: false },
}

async function guestSearch(rawToken: string, personId: string) {
  const agent = request.agent(app)
  const landing = await agent.get(`/api/guest/events/${rawToken}`)
  const sessionId = landing.body.sessionId as string
  await agent.post(`/api/guest/sessions/${sessionId}/consent`).send(validConsentBody)
  const selfieBuffer = await renderSyntheticPhoto([{ personId, x: 260, y: 130, size: 300 }], 'selfie')
  const selfie = await agent.post(`/api/guest/sessions/${sessionId}/selfie`).attach('selfie', selfieBuffer, 'selfie.jpg')
  const searchId = selfie.body.faceSearchId as string
  return { agent, sessionId, searchId }
}

describe('POST /api/guest/sessions/:sessionId/downloads/:downloadJobId/process', () => {
  it("claims and runs the guest's own ZIP job, and a repeat call finds nothing left to process", async () => {
    const { eventId, rawToken } = await setupLiveEvent('person-1')
    void eventId
    const { agent, sessionId, searchId } = await guestSearch(rawToken, 'person-1')

    const zipReq = await agent.post(`/api/guest/sessions/${sessionId}/searches/${searchId}/download-zip`).send({ all: true })
    const downloadJobId = zipReq.body.downloadJobId as string

    const first = await agent.post(`/api/guest/sessions/${sessionId}/downloads/${downloadJobId}/process`)
    expect(first.status).toBe(200)
    expect(first.body.processed).toBe(true)
    expect(first.body.result).toBe('completed')

    const status = await agent.get(`/api/guest/sessions/${sessionId}/downloads/${downloadJobId}`)
    expect(status.body.status).toBe('COMPLETED')
    expect(status.body.url).toBeTruthy()

    const second = await agent.post(`/api/guest/sessions/${sessionId}/downloads/${downloadJobId}/process`)
    expect(second.body.processed).toBe(false)
    expect(second.body.result).toBe('nothing_to_process')
  })

  it("refuses to process another guest's download job (ownership check, not just job-type scoping)", async () => {
    const { rawToken } = await setupLiveEvent('person-1')
    const guestA = await guestSearch(rawToken, 'person-1')
    const guestB = await guestSearch(rawToken, 'person-1')

    const zipReqA = await guestA.agent.post(`/api/guest/sessions/${guestA.sessionId}/searches/${guestA.searchId}/download-zip`).send({ all: true })
    const downloadJobId = zipReqA.body.downloadJobId as string

    // Guest B attempts to process guest A's job using B's own valid session cookie.
    const res = await guestB.agent.post(`/api/guest/sessions/${guestB.sessionId}/downloads/${downloadJobId}/process`)
    expect(res.status).toBe(404)
  })
})
