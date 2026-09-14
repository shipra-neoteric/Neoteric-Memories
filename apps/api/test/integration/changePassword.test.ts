import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { app, loginAsAgent, makeUser } from '../helpers.js'

describe('Self-service change password', () => {
  it('changes the password, revokes the current session, and allows logging in with the new password', async () => {
    const { user, password } = await makeUser('MASTER_ADMIN')
    const client = await loginAsAgent(user.email, password)

    const newPassword = 'a-brand-new-password-of-any-length'
    const changeRes = await client.post('/api/admin/auth/change-password').send({ currentPassword: password, newPassword })
    expect(changeRes.status).toBe(200)

    // The session that made the change is itself revoked as part of the change —
    // the same cookies must no longer authenticate.
    const meAfter = await client.get('/api/admin/auth/me')
    expect(meAfter.status).toBe(401)

    // The old password no longer works...
    const oldLogin = await request(app).post('/api/admin/auth/login').send({ email: user.email, password })
    expect(oldLogin.status).toBe(401)

    // ...but the new one does.
    const newLogin = await request(app).post('/api/admin/auth/login').send({ email: user.email, password: newPassword })
    expect(newLogin.status).toBe(200)
  })

  it('rejects the change when currentPassword does not match, and does not touch the real password', async () => {
    const { user, password } = await makeUser('EVENT_MANAGER')
    const client = await loginAsAgent(user.email, password)

    const res = await client.post('/api/admin/auth/change-password').send({ currentPassword: `${password}-wrong`, newPassword: 'anything-goes-here' })
    expect(res.status).toBe(403)

    // Original password still works — nothing was changed.
    const stillWorks = await request(app).post('/api/admin/auth/login').send({ email: user.email, password })
    expect(stillWorks.status).toBe(200)
  })

  it('rejects a change-password request without a matching CSRF header', async () => {
    const { user, password } = await makeUser('MASTER_ADMIN')
    const client = await loginAsAgent(user.email, password)
    const res = await client.agent.post('/api/admin/auth/change-password').send({ currentPassword: password, newPassword: 'some-new-password' })
    expect(res.status).toBe(403)
  })

  it('accepts a very short new password — there is no minimum length restriction', async () => {
    const { user, password } = await makeUser('MASTER_ADMIN')
    const client = await loginAsAgent(user.email, password)
    const res = await client.post('/api/admin/auth/change-password').send({ currentPassword: password, newPassword: 'x' })
    expect(res.status).toBe(200)

    const login = await request(app).post('/api/admin/auth/login').send({ email: user.email, password: 'x' })
    expect(login.status).toBe(200)
  })
})
