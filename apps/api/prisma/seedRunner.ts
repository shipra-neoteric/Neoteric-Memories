import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getPrisma } from '../src/db.js'
import { hashPassword } from '../src/lib/password.js'
import { logger } from '../src/lib/logger.js'
import { createEvent, transitionEventStatus, assignEventMember } from '../src/modules/events/service.js'
import { generateEventAccessToken } from '../src/modules/events/accessTokens.js'
import { checkEventReadiness } from '../src/modules/events/readiness.js'
import { uploadPhotoBatch } from '../src/modules/photos/service.js'
import { processPhotoProcess } from '../src/jobs/processors/photoProcess.js'
import { renderSyntheticPhoto, renderSyntheticSelfie } from './seedImages.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const DEMO_PASSWORD = 'NeotericDemo#2026'

/**
 * Idempotent (upsert-based throughout) — safe to call more than once against the
 * same database, including automatically on every dev-server boot when running in
 * zero-config ephemeral-Mongo mode (see server.ts).
 */
export async function runSeed(): Promise<void> {
  const prisma = getPrisma()
  logger.info({}, 'Seeding Neoteric Memories demo data...')

  // ---- Sites -----------------------------------------------------------
  const siteDefs = [
    { name: 'Silver Estate', code: 'SILVER_ESTATE', city: 'Pune' },
    { name: 'Regal Garden', code: 'REGAL_GARDEN', city: 'Pune' },
    { name: 'Nature Park', code: 'NATURE_PARK', city: 'Nashik' },
    { name: 'Garden City', code: 'GARDEN_CITY', city: 'Nashik' },
  ]
  const sites = new Map<string, Awaited<ReturnType<typeof prisma.site.upsert>>>()
  for (const s of siteDefs) {
    const site = await prisma.site.upsert({ where: { code: s.code }, update: {}, create: s })
    sites.set(s.code, site)
  }

  // ---- Consent version ---------------------------------------------------
  let consentVersion = await prisma.consentVersion.findFirst({ where: { isActive: true } })
  if (!consentVersion) {
    consentVersion = await prisma.consentVersion.create({
      data: {
        label: 'Guest Face Search Consent v1 (DRAFT — pending legal review)',
        isActive: true,
        requiredText: {
          search_purpose:
            'I understand my selfie will be used only to search this event\'s photographs for pictures I appear in.',
          match_accuracy_disclaimer:
            'I understand face matching is probabilistic and may produce incomplete or inaccurate results — this is not an identity verification.',
          retention_policy:
            'I understand my selfie is deleted immediately after matching (within 24 hours at most), and my search session data is kept temporarily as described in the privacy notice.',
        },
        optionalText: {
          marketing_contact: 'I agree that Neoteric Properties may contact me about this event.',
          marketing_photo_use: 'I agree that photographs I am shown may be considered for marketing use.',
        },
      },
    })
  }

  // ---- Retention policy ---------------------------------------------------
  const existingDefaultPolicy = await prisma.retentionPolicy.findFirst({ where: { isDefault: true } })
  if (!existingDefaultPolicy) {
    await prisma.retentionPolicy.create({
      data: {
        label: 'Default L1 policy',
        guestSessionTtlHours: 24,
        galleryAccessTtlHours: 24,
        signedUrlTtlMinutes: 15,
        selfieMaxRetentionHours: 24,
        eventFaceIndexRetentionDays: 45,
        isDefault: true,
      },
    })
  }

  // ---- Users ---------------------------------------------------------
  const userDefs = [
    { name: 'Aarav Master (Admin)', email: 'admin@neotericproperties.demo', role: 'MASTER_ADMIN' as const },
    { name: 'Meera Kapoor (Marketing Head)', email: 'marketing@neotericproperties.demo', role: 'MARKETING_HEAD' as const },
    { name: 'Sanjay Rao (Event Manager)', email: 'eventmanager@neotericproperties.demo', role: 'EVENT_MANAGER' as const },
    { name: 'Divya Iyer (Photographer)', email: 'photographer@neotericproperties.demo', role: 'PHOTOGRAPHER' as const },
    { name: 'Farhan Sheikh (Support)', email: 'support@neotericproperties.demo', role: 'SUPPORT_EXECUTIVE' as const },
  ]
  const passwordHash = await hashPassword(DEMO_PASSWORD)
  const users = new Map<string, Awaited<ReturnType<typeof prisma.user.upsert>>>()
  for (const u of userDefs) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: { name: u.name, email: u.email, passwordHash, role: u.role, isActive: true },
    })
    users.set(u.role, user)
  }

  const masterAdmin = users.get('MASTER_ADMIN')!
  const marketingHead = users.get('MARKETING_HEAD')!
  const eventManager = users.get('EVENT_MANAGER')!
  const photographer = users.get('PHOTOGRAPHER')!

  for (const site of sites.values()) {
    await prisma.userSiteAccess.upsert({
      where: { userId_siteId: { userId: marketingHead.id, siteId: site.id } },
      update: {},
      create: { userId: marketingHead.id, siteId: site.id },
    })
  }

  // ---- Events ---------------------------------------------------------
  const now = Date.now()
  const day = 24 * 60 * 60 * 1000

  const eventDefs = [
    {
      name: 'Ganesh Chaturthi Celebration',
      type: 'FESTIVAL' as const,
      siteCode: 'SILVER_ESTATE',
      venue: 'Silver Estate Clubhouse Lawn',
      description: 'Annual Ganesh Chaturthi celebration for residents and prospective buyers.',
      startOffsetDays: -10,
      likelyIncludesChildren: true,
    },
    {
      name: 'Diwali Customer Meet',
      type: 'CUSTOMER_MEET' as const,
      siteCode: 'REGAL_GARDEN',
      venue: 'Regal Garden Sales Pavilion',
      description: 'Diwali customer appreciation evening with existing flat owners.',
      startOffsetDays: -5,
      likelyIncludesChildren: false,
    },
    {
      name: 'Janmashtami Celebration',
      type: 'FESTIVAL' as const,
      siteCode: 'NATURE_PARK',
      venue: 'Nature Park Community Hall',
      description: 'Janmashtami festivities with the Nature Park resident community.',
      startOffsetDays: -2,
      likelyIncludesChildren: true,
    },
  ]

  interface SeedOutputEvent {
    name: string
    guestUrl: string
    qrPngDataUrl: string
  }
  const seedOutput: { demoPassword: string; users: { role: string; email: string }[]; events: SeedOutputEvent[] } = {
    demoPassword: DEMO_PASSWORD,
    users: userDefs.map((u) => ({ role: u.role, email: u.email })),
    events: [],
  }

  for (const def of eventDefs) {
    const site = sites.get(def.siteCode)!
    const startAt = new Date(now + def.startOffsetDays * day)
    const endAt = new Date(startAt.getTime() + 5 * 60 * 60 * 1000)

    const existing = await prisma.event.findFirst({ where: { name: def.name, siteId: site.id } })
    const event =
      existing ??
      (await createEvent(
        {
          name: def.name,
          type: def.type,
          siteId: site.id,
          venue: def.venue,
          description: def.description,
          startAt,
          endAt,
          guestAccessOpensAt: startAt,
          guestAccessExpiresAt: new Date(now + 30 * day),
          faceIndexDeleteAt: new Date(now + 45 * day),
          originalPhotoRetentionUntil: new Date(now + 90 * day),
          consentVersionId: consentVersion.id,
          likelyIncludesChildren: def.likelyIncludesChildren,
          guardianAssistedFlow: def.likelyIncludesChildren,
          selfieUploadFallbackEnabled: true, // demo convenience: lets reviewers use the bundled demo-selfie fixtures without a webcam
        },
        masterAdmin
      ))

    if (!existing) {
      await assignEventMember(event.id, eventManager.id, 'EVENT_MANAGER', masterAdmin)
      await assignEventMember(event.id, photographer.id, 'PHOTOGRAPHER', masterAdmin)

      // ---- Synthetic demo photos --------------------------------------
      const photoDefs: { label: string; markers: { personId: string; x: number; y: number; size: number }[] }[] = [
        { label: `${def.name} — solo portrait`, markers: [{ personId: 'person-1', x: 360, y: 140, size: 200 }] },
        {
          label: `${def.name} — group photo`,
          markers: [
            { personId: 'person-1', x: 120, y: 160, size: 160 },
            { personId: 'person-2', x: 380, y: 150, size: 160 },
            { personId: 'person-3', x: 640, y: 160, size: 160 },
          ],
        },
        { label: `${def.name} — candid`, markers: [{ personId: 'person-4', x: 300, y: 180, size: 180 }] },
        {
          label: `${def.name} — crowd shot (small faces)`,
          markers: [
            { personId: 'person-5', x: 100, y: 200, size: 60 },
            { personId: 'person-6', x: 300, y: 210, size: 60 },
            { personId: 'person-7', x: 500, y: 205, size: 60 },
            { personId: 'person-8', x: 700, y: 215, size: 60 },
          ],
        },
        { label: `${def.name} — decor / no people`, markers: [] },
      ]

      const files = await Promise.all(
        photoDefs.map(async (p, i) => ({
          buffer: await renderSyntheticPhoto(p.markers, p.label),
          originalFilename: `${def.siteCode.toLowerCase()}-${i + 1}.jpg`,
          declaredMimeType: 'image/jpeg',
        }))
      )

      const outcome = await uploadPhotoBatch(event.id, files, masterAdmin)
      for (const accepted of outcome.accepted) {
        await processPhotoProcess({ photoId: accepted.photoId })
      }

      await checkEventReadiness(event.id)
      await transitionEventStatus(event.id, 'LIVE', 'Seed data — demo ready', masterAdmin)
    }

    // Access tokens are only ever shown once (raw tokens are never persisted — see
    // accessTokens.ts) — so re-running the seed against an already-seeded database
    // must NOT regenerate (and thereby invalidate) an event's existing QR/link.
    const activeToken = await prisma.eventAccessToken.findFirst({ where: { eventId: event.id, isActive: true } })
    if (!activeToken) {
      const tokenResult = await generateEventAccessToken(event.id, masterAdmin)
      seedOutput.events.push({ name: def.name, guestUrl: tokenResult.guestUrl, qrPngDataUrl: tokenResult.qrPngDataUrl })
      logger.info({ event: def.name, guestUrl: tokenResult.guestUrl }, 'Event seeded and LIVE')
    } else {
      seedOutput.events.push({
        name: def.name,
        guestUrl: '(unchanged — already has an active QR/link; see the admin Events page or re-generate it there)',
        qrPngDataUrl: '',
      })
      logger.info({ event: def.name }, 'Event already seeded with an active access token — left unchanged')
    }
  }

  // ---- Demo selfie fixtures (for the upload-fallback manual test path) ----
  const selfiesDir = path.join(__dirname, '..', 'seed-assets', 'demo-selfies')
  await fs.mkdir(selfiesDir, { recursive: true })
  for (const personId of ['person-1', 'person-2', 'person-4']) {
    const buffer = await renderSyntheticSelfie(personId)
    await fs.writeFile(path.join(selfiesDir, `${personId}.jpg`), buffer)
  }

  const outputPath = path.join(__dirname, '..', '.seed-output.json')
  await fs.writeFile(outputPath, JSON.stringify(seedOutput, null, 2))

  logger.info({}, '')
  logger.info({}, '=== Seed complete ===')
  logger.info({}, `Demo password for every seeded user: ${DEMO_PASSWORD}`)
  for (const u of userDefs) logger.info({}, `  ${u.role.padEnd(18)} ${u.email}`)
  logger.info({}, '')
  logger.info({}, `Guest URLs + QR codes written to: ${outputPath}`)
  logger.info({}, `Demo selfie fixtures (for the upload-fallback path) written to: ${selfiesDir}`)
  for (const e of seedOutput.events) logger.info({}, `  ${e.name}: ${e.guestUrl}`)
}
