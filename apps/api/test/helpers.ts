import request from 'supertest'
import { getPrisma } from '../src/db.js'
import { hashPassword } from '../src/lib/password.js'
import { createApp } from '../src/app.js'
import { ROLE_PERMISSIONS, type Permission, type Role } from '@neoteric-memories/shared'

export const app = createApp()

let siteCounter = 0
let userCounter = 0

export async function makeSite(overrides: Partial<{ name: string; code: string }> = {}) {
  siteCounter += 1
  return getPrisma().site.create({
    data: { name: overrides.name ?? `Test Site ${siteCounter}`, code: overrides.code ?? `TEST_SITE_${siteCounter}`, isActive: true },
  })
}

export async function makeUser(
  role: Role,
  overrides: Partial<{ email: string; password: string; isActive: boolean; permissions: Permission[] }> = {}
) {
  userCounter += 1
  const password = overrides.password ?? 'TestPassword123!'
  const passwordHash = await hashPassword(password)
  const user = await getPrisma().user.create({
    data: {
      name: `Test ${role} ${userCounter}`,
      email: overrides.email ?? `test-${role.toLowerCase()}-${userCounter}@example.test`,
      passwordHash,
      role,
      // Defaults to the role's reference permission set so every existing test
      // (written when permissions were role-derived) keeps behaving identically —
      // pass `overrides.permissions` explicitly to test a custom/restricted grant.
      permissions: overrides.permissions ?? [...ROLE_PERMISSIONS[role]],
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

/**
 * Polls `check` until it returns a truthy value, for asserting on work that a route
 * deliberately kicks off in the background instead of awaiting (e.g. the photo
 * upload route's HEIC conversion + storage upload — see modules/photos/router.ts).
 * Throws if `check` hasn't returned truthy within `timeoutMs`.
 */
export async function waitFor<T>(check: () => Promise<T | undefined | null | false>, timeoutMs = 5000, intervalMs = 50): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const result = await check()
    if (result) return result
    if (Date.now() >= deadline) throw new Error(`waitFor: condition not met within ${timeoutMs}ms`)
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}

export const DAY_MS = 24 * 60 * 60 * 1000

/**
 * The photo upload route only awaits the quick classification pass before
 * responding — the actual DB row + storage upload happen in the background (see
 * modules/photos/router.ts) — so tests wait for the photo to be fully written
 * (originalKey moves off its 'pending' placeholder once the storage upload
 * finishes) rather than reading a photoId off the upload response.
 */
export async function waitForPhotoReady(eventId: string, originalFilename: string): Promise<string> {
  const photo = await waitFor(() =>
    getPrisma().photo.findFirst({ where: { eventId, originalFilename, originalKey: { not: 'pending' } } })
  )
  return photo.id
}

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
  await client.post(`/api/admin/events/${eventId}/photos`).attach('photos', buffer, 'photo.jpg')
  const photoId = await waitForPhotoReady(eventId, 'photo.jpg')
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
