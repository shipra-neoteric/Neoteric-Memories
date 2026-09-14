import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { app, loginAsAgent, makeSite, makeUser, validEventPayload } from '../helpers.js'

describe('Admin authentication', () => {
  it('rejects an invalid password', async () => {
    const { user, password } = await makeUser('MASTER_ADMIN')
    const res = await request(app).post('/api/admin/auth/login').send({ email: user.email, password: `${password}-wrong` })
    expect(res.status).toBe(401)
  })

  it('logs in and can read /me with a valid session cookie', async () => {
    const { user, password } = await makeUser('MARKETING_HEAD')
    const client = await loginAsAgent(user.email, password)
    const me = await client.get('/api/admin/auth/me')
    expect(me.status).toBe(200)
    expect(me.body.user.role).toBe('MARKETING_HEAD')
  })

  it('rejects state-changing requests without a matching CSRF header', async () => {
    const { user, password } = await makeUser('MASTER_ADMIN')
    const client = await loginAsAgent(user.email, password)
    // Use the underlying agent directly, bypassing the helper's automatic CSRF header.
    const res = await client.agent.post('/api/admin/sites').send({ name: 'No CSRF Site', code: 'NOCSRF' })
    expect(res.status).toBe(403)
  })

  it('rejects an inactive user even with correct credentials', async () => {
    const { user, password } = await makeUser('EVENT_MANAGER', { isActive: false })
    const res = await request(app).post('/api/admin/auth/login').send({ email: user.email, password })
    expect(res.status).toBe(401)
  })
})

describe('RBAC + site scoping enforcement', () => {
  it('denies PHOTOGRAPHER from creating a site (insufficient permission)', async () => {
    const { user, password } = await makeUser('PHOTOGRAPHER')
    const client = await loginAsAgent(user.email, password)
    const res = await client.post('/api/admin/sites').send({ name: 'Denied Site', code: 'DENIED1' })
    expect(res.status).toBe(403)
  })

  it('denies a MARKETING_HEAD from creating an event at a site they have no access to', async () => {
    const siteA = await makeSite()
    const { user, password } = await makeUser('MARKETING_HEAD')
    const client = await loginAsAgent(user.email, password)

    const res = await client.post('/api/admin/events').send({
      name: 'Cross-site attempt',
      type: 'OTHER',
      siteId: siteA.id,
      venue: 'Somewhere',
      startAt: new Date().toISOString(),
      endAt: new Date(Date.now() + 3600_000).toISOString(),
      guestAccessOpensAt: new Date().toISOString(),
      guestAccessExpiresAt: new Date(Date.now() + 86400_000).toISOString(),
      faceIndexDeleteAt: new Date(Date.now() + 30 * 86400_000).toISOString(),
      originalPhotoRetentionUntil: new Date(Date.now() + 90 * 86400_000).toISOString(),
    })
    expect(res.status).toBe(403)
  })

  it('allows MASTER_ADMIN to manage sites regardless of scoping', async () => {
    const { user, password } = await makeUser('MASTER_ADMIN')
    const client = await loginAsAgent(user.email, password)
    const res = await client.post('/api/admin/sites').send({ name: 'Admin Site', code: `ADM_${Date.now() % 1000000}` })
    expect(res.status).toBe(201)
  })
})

describe('Per-user permission overrides (permissions now live on the user, not derived from role alone)', () => {
  it('denies a PHOTOGRAPHER whose stored permissions have photo:upload explicitly removed, even though the role normally allows it, and even when assigned to the event', async () => {
    const { ROLE_PERMISSIONS } = await import('@neoteric-memories/shared')
    const restricted = ROLE_PERMISSIONS.PHOTOGRAPHER.filter((p) => p !== 'photo:upload')
    const { user: photographer, password } = await makeUser('PHOTOGRAPHER', { permissions: [...restricted] })

    const { user: admin, password: adminPassword } = await makeUser('MASTER_ADMIN')
    const adminClient = await loginAsAgent(admin.email, adminPassword)
    const site = await makeSite()
    const eventRes = await adminClient.post('/api/admin/events').send(validEventPayload(site.id))
    const eventId = eventRes.body.event.id as string
    await adminClient.post(`/api/admin/events/${eventId}/assignments`).send({ userId: photographer.id, role: 'PHOTOGRAPHER' })

    const photographerClient = await loginAsAgent(photographer.email, password)
    const uploadRes = await photographerClient.post(`/api/admin/events/${eventId}/photos`).attach('photos', Buffer.from('not a real image'), 'photo.jpg')
    expect(uploadRes.status).toBe(403)
  })

  it('grants a SUPPORT_EXECUTIVE the ability to manage sites once explicitly given site:manage, despite their role never including it by default', async () => {
    const { user, password } = await makeUser('SUPPORT_EXECUTIVE', { permissions: ['site:manage', 'report:view'] })
    const client = await loginAsAgent(user.email, password)
    const res = await client.post('/api/admin/sites').send({ name: 'Override Site', code: `OVR_${Date.now() % 1000000}` })
    expect(res.status).toBe(201)
  })

  it('denies that same SUPPORT_EXECUTIVE a permission not in their override list', async () => {
    const { user, password } = await makeUser('SUPPORT_EXECUTIVE', { permissions: ['site:manage'] })
    const client = await loginAsAgent(user.email, password)
    const res = await client.get('/api/admin/users')
    expect(res.status).toBe(403)
  })
})
