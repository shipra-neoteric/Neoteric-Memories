import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { app, loginAsAgent, makeSite, makeUser } from '../helpers.js'

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
