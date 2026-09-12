import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from '../../src/app.js'

describe('CORS configuration', () => {
  const app = createApp()

  it('allows requests and echoes origin for any domain', async () => {
    const res = await request(app)
      .get('/health')
      .set('Origin', 'http://random-custom-domain.com:3000')

    expect(res.status).toBe(200)
    expect(res.headers['access-control-allow-origin']).toBe('http://random-custom-domain.com:3000')
    expect(res.headers['access-control-allow-credentials']).toBe('true')
  })

  it('handles preflight OPTIONS requests for any domain', async () => {
    const res = await request(app)
      .options('/api/guest/resolve-token')
      .set('Origin', 'https://another-client.app')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'Content-Type, X-Device-Id')

    expect(res.status).toBe(204)
    expect(res.headers['access-control-allow-origin']).toBe('https://another-client.app')
    expect(res.headers['access-control-allow-credentials']).toBe('true')
    expect(res.headers['access-control-allow-headers']).toMatch(/Content-Type/i)
  })
})
