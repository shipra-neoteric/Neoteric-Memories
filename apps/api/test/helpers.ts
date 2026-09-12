import request from 'supertest'
import { getPrisma } from '../src/db.js'
import { hashPassword } from '../src/lib/password.js'
import { createApp } from '../src/app.js'
import type { Role } from '@neoteric-memories/shared'

export const app = createApp()

let siteCounter = 0
let userCounter = 0

export async function makeSite(overrides: Partial<{ name: string; code: string }> = {}) {
  siteCounter += 1
  return getPrisma().site.create({
    data: { name: overrides.name ?? `Test Site ${siteCounter}`, code: overrides.code ?? `TEST_SITE_${siteCounter}`, isActive: true },
  })
}

export async function makeUser(role: Role, overrides: Partial<{ email: string; password: string; isActive: boolean }> = {}) {
  userCounter += 1
  const password = overrides.password ?? 'TestPassword123!'
  const passwordHash = await hashPassword(password)
  const user = await getPrisma().user.create({
    data: {
      name: `Test ${role} ${userCounter}`,
      email: overrides.email ?? `test-${role.toLowerCase()}-${userCounter}@example.test`,
      passwordHash,
      role,
      isActive: overrides.isActive ?? true,
    },
  })
  return { user, password }
}

export async function makeConsentVersion() {
  return getPrisma().consentVersion.create({
    data: {
      label: 'Test consent version',
      isActive: true,
      requiredText: { search_purpose: 'x', match_accuracy_disclaimer: 'x', retention_policy: 'x' },
      optionalText: { marketing_contact: 'x', marketing_photo_use: 'x' },
    },
  })
}

/**
 * Logs in via the real HTTP endpoint and returns a small client that carries
 * cookies + the CSRF header automatically — mirrors exactly what the browser does,
 * so tests exercise the real auth/CSRF middleware rather than bypassing it.
 */
export async function loginAsAgent(email: string, password: string) {
  const agent = request.agent(app)
  const res = await agent.post('/api/admin/auth/login').send({ email, password })
  if (res.status !== 200) throw new Error(`Login failed: ${res.status} ${JSON.stringify(res.body)}`)
  const csrfToken = res.body.csrfToken as string

  return {
    agent,
    user: res.body.user,
    get: (url: string) => agent.get(url),
    post: (url: string) => agent.post(url).set('X-CSRF-Token', csrfToken),
    patch: (url: string) => agent.patch(url).set('X-CSRF-Token', csrfToken),
    delete: (url: string) => agent.delete(url).set('X-CSRF-Token', csrfToken),
  }
}

export function futureDate(msFromNow: number): Date {
  return new Date(Date.now() + msFromNow)
}

export const DAY_MS = 24 * 60 * 60 * 1000

export async function setupLiveEvent(markerPersonId: string | null, overrides: Record<string, unknown> = {}) {
  const { renderSyntheticPhoto } = await import('../src/devSeed/seedImages.js')
  const { processPhotoProcess } = await import('../src/jobs/processors/photoProcess.js')

  const site = await makeSite()
  const consent = await makeConsentVersion()
  const { user, password } = await makeUser('MASTER_ADMIN')
  const client = await loginAsAgent(user.email, password)

  const created = await client.post('/api/admin/events').send(
    validEventPayload(site.id, { consentVersionId: consent.id, selfieUploadFallbackEnabled: true, ...overrides })
  )
  const eventId = created.body.event.id as string

  const buffer = await renderSyntheticPhoto(
    markerPersonId ? [{ personId: markerPersonId, x: 200, y: 100, size: 220 }] : [],
    'guest flow test photo'
  )
  const upload = await client.post(`/api/admin/events/${eventId}/photos`).attach('photos', buffer, 'photo.jpg')
  const photoId = upload.body.accepted[0]?.photoId as string | undefined
  if (photoId) await processPhotoProcess({ photoId })

  await client.post(`/api/admin/events/${eventId}/status`).send({ status: 'LIVE' })
  const tokenRes = await client.post(`/api/admin/events/${eventId}/access-token`).send({})
  const rawToken = (tokenRes.body.guestUrl as string).split('/e/').pop()!

  return { adminClient: client, eventId, photoId, rawToken, consentVersionId: consent.id }
}

export function validEventPayload(siteId: string, overrides: Record<string, unknown> = {}) {
  const now = Date.now()
  return {
    name: 'Test Event',
    type: 'OTHER',
    siteId,
    venue: 'Test Venue',
    startAt: new Date(now).toISOString(),
    endAt: new Date(now + 3 * 60 * 60 * 1000).toISOString(),
    guestAccessOpensAt: new Date(now).toISOString(),
    guestAccessExpiresAt: new Date(now + DAY_MS).toISOString(),
    faceIndexDeleteAt: new Date(now + 45 * DAY_MS).toISOString(),
    originalPhotoRetentionUntil: new Date(now + 90 * DAY_MS).toISOString(),
    selfieUploadFallbackEnabled: true,
    ...overrides,
  }
}
