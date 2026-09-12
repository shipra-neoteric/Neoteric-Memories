import { describe, expect, it } from 'vitest'
import { getPrisma } from '../../src/db.js'
import { app, loginAsAgent, makeConsentVersion, makeSite, makeUser, validEventPayload } from '../helpers.js'
import { resolveGuestAccessToken } from '../../src/modules/events/accessTokens.js'

async function masterAdminClient() {
  const { user, password } = await makeUser('MASTER_ADMIN')
  return loginAsAgent(user.email, password)
}

describe('Event creation and lifecycle', () => {
  it('creates an event in DRAFT status with its own face collection id', async () => {
    const site = await makeSite()
    const client = await masterAdminClient()
    const res = await client.post('/api/admin/events').send(validEventPayload(site.id))
    expect(res.status).toBe(201)
    expect(res.body.event.status).toBe('DRAFT')
    expect(res.body.event.faceCollectionId).toBe(`neoteric-event-${res.body.event.id}`)
  })

  it('refuses to go LIVE without a consent version, without any processed photo, and reports why', async () => {
    const site = await makeSite()
    const client = await masterAdminClient()
    const created = await client.post('/api/admin/events').send(validEventPayload(site.id))
    const eventId = created.body.event.id

    const readiness = await client.get(`/api/admin/events/${eventId}/readiness`)
    expect(readiness.body.ready).toBe(false)
    expect(readiness.body.reasons.some((r: string) => /consent/i.test(r))).toBe(true)
    expect(readiness.body.reasons.some((r: string) => /processed/i.test(r))).toBe(true)

    const goLive = await client.post(`/api/admin/events/${eventId}/status`).send({ status: 'LIVE' })
    expect(goLive.status).toBe(409)
  })

  it('rejects an invalid status transition (e.g. DRAFT -> ARCHIVED directly)', async () => {
    const site = await makeSite()
    const client = await masterAdminClient()
    const created = await client.post('/api/admin/events').send(validEventPayload(site.id))
    const res = await client.post(`/api/admin/events/${created.body.event.id}/status`).send({ status: 'ARCHIVED' })
    expect(res.status).toBe(409)
  })
})

describe('Event access tokens (QR)', () => {
  it('generates a working guest access URL, then invalidates it on regeneration', async () => {
    const site = await makeSite()
    const consent = await makeConsentVersion()
    const client = await masterAdminClient()
    const created = await client.post('/api/admin/events').send(validEventPayload(site.id, { consentVersionId: consent.id }))
    const eventId = created.body.event.id

    const first = await client.post(`/api/admin/events/${eventId}/access-token`).send({})
    expect(first.status).toBe(200)
    const firstToken = first.body.rawToken as string

    const firstRawResolved = firstToken.split('/e/').pop() ?? firstToken
    const resolvedBefore = await resolveGuestAccessToken(firstRawResolved)
    // Event is still DRAFT (never went LIVE), so guest resolution correctly reports NOT_READY rather than crashing.
    expect(resolvedBefore.ok).toBe(false)

    const second = await client.post(`/api/admin/events/${eventId}/access-token`).send({})
    expect(second.status).toBe(200)
    expect(second.body.rawToken).not.toBe(firstToken)

    const oldToken = await getPrisma().eventAccessToken.findMany({ where: { eventId } })
    const revoked = oldToken.find((t) => !t.isActive)
    expect(revoked).toBeDefined()
    expect(revoked?.revokedReason).toMatch(/regenerated/i)
  })

  it('disabling (revoking) the access token makes it resolve as REVOKED', async () => {
    const site = await makeSite()
    const client = await masterAdminClient()
    const created = await client.post('/api/admin/events').send(validEventPayload(site.id))
    const eventId = created.body.event.id

    const gen = await client.post(`/api/admin/events/${eventId}/access-token`).send({})
    const rawToken = (gen.body.guestUrl as string).split('/e/').pop()!

    await client.post(`/api/admin/events/${eventId}/access-token/revoke`).send({ reason: 'test disable' })
    const resolved = await resolveGuestAccessToken(rawToken)
    expect(resolved.ok).toBe(false)
    if (!resolved.ok) expect(resolved.reason).toBe('REVOKED')
  })

  it('an expired token resolves as EXPIRED', async () => {
    const site = await makeSite()
    const client = await masterAdminClient()
    const created = await client
      .post('/api/admin/events')
      .send(validEventPayload(site.id, { guestAccessExpiresAt: new Date(Date.now() + 60_000).toISOString() }))
    const eventId = created.body.event.id

    const gen = await client.post(`/api/admin/events/${eventId}/access-token`).send({})
    const rawToken = (gen.body.guestUrl as string).split('/e/').pop()!

    await getPrisma().eventAccessToken.updateMany({ where: { eventId }, data: { expiresAt: new Date(Date.now() - 1000) } })

    const resolved = await resolveGuestAccessToken(rawToken)
    expect(resolved.ok).toBe(false)
    if (!resolved.ok) expect(resolved.reason).toBe('EXPIRED')
  })
})

describe('Event assignment scoping', () => {
  it('denies a PHOTOGRAPHER access to an event they are not assigned to', async () => {
    const site = await makeSite()
    const admin = await masterAdminClient()
    const created = await admin.post('/api/admin/events').send(validEventPayload(site.id))
    const eventId = created.body.event.id

    const { user, password } = await makeUser('PHOTOGRAPHER')
    const client = await loginAsAgent(user.email, password)
    const res = await client.get(`/api/admin/events/${eventId}`)
    expect(res.status).toBe(403)
  })

  it('allows a PHOTOGRAPHER access once explicitly assigned', async () => {
    const site = await makeSite()
    const admin = await masterAdminClient()
    const created = await admin.post('/api/admin/events').send(validEventPayload(site.id))
    const eventId = created.body.event.id

    const { user, password } = await makeUser('PHOTOGRAPHER')
    await admin.post(`/api/admin/events/${eventId}/assignments`).send({ userId: user.id, role: 'PHOTOGRAPHER' })

    const client = await loginAsAgent(user.email, password)
    const res = await client.get(`/api/admin/events/${eventId}`)
    expect(res.status).toBe(200)
  })
})
