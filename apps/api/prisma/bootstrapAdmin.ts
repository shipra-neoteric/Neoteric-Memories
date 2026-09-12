// One-time bootstrap for a REAL (non-demo) database: creates a real Master Admin
// user plus the minimum reference data (a draft consent version, a default
// retention policy) needed before you can create your first real site/event
// through the admin UI. Does NOT create any fake sites/events/photos — unlike
// prisma/seed.ts, this is safe to run against a production database.
//
// Usage: BOOTSTRAP_ADMIN_EMAIL=you@company.com BOOTSTRAP_ADMIN_NAME="Your Name" npx tsx prisma/bootstrapAdmin.ts
// (both env vars are optional — see the fallbacks below)
import crypto from 'node:crypto'
import { connectDatabase, getPrisma, disconnectDatabase } from '../src/db.js'
import { hashPassword } from '../src/lib/password.js'
import { logger } from '../src/lib/logger.js'

const ADMIN_EMAIL = process.env.BOOTSTRAP_ADMIN_EMAIL ?? 'admin@neotericproperties.com'
const ADMIN_NAME = process.env.BOOTSTRAP_ADMIN_NAME ?? 'Admin'

async function main() {
  await connectDatabase()
  const prisma = getPrisma()

  const existing = await prisma.user.findUnique({ where: { email: ADMIN_EMAIL } })
  let tempPassword: string | null = null
  if (existing) {
    logger.info({}, `User ${ADMIN_EMAIL} already exists (role: ${existing.role}) — leaving it as-is.`)
  } else {
    tempPassword = crypto.randomBytes(9).toString('base64url')
    const passwordHash = await hashPassword(tempPassword)
    await prisma.user.create({
      data: { name: ADMIN_NAME, email: ADMIN_EMAIL, passwordHash, role: 'MASTER_ADMIN', isActive: true },
    })
    logger.info({}, `Created Master Admin user: ${ADMIN_EMAIL}`)
  }

  const existingConsent = await prisma.consentVersion.findFirst({ where: { isActive: true } })
  if (!existingConsent) {
    await prisma.consentVersion.create({
      data: {
        label: 'Guest Face Search Consent v1 (DRAFT — pending legal review)',
        isActive: true,
        requiredText: {
          search_purpose: "I understand my selfie will be used only to search this event's photographs for pictures I appear in.",
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
    logger.info({}, 'Created a default (draft) consent version.')
  } else {
    logger.info({}, 'An active consent version already exists — left as-is.')
  }

  const existingPolicy = await prisma.retentionPolicy.findFirst({ where: { isDefault: true } })
  if (!existingPolicy) {
    await prisma.retentionPolicy.create({
      data: {
        label: 'Default policy',
        guestSessionTtlHours: 24,
        galleryAccessTtlHours: 24,
        signedUrlTtlMinutes: 15,
        selfieMaxRetentionHours: 24,
        eventFaceIndexRetentionDays: 45,
        isDefault: true,
      },
    })
    logger.info({}, 'Created a default retention policy.')
  } else {
    logger.info({}, 'A default retention policy already exists — left as-is.')
  }

  logger.info({}, '')
  logger.info({}, '=== Bootstrap complete ===')
  logger.info({}, `Login email: ${ADMIN_EMAIL}`)
  if (tempPassword) {
    logger.info({}, `Temporary password: ${tempPassword}`)
    logger.info({}, 'Log in now and change this password via Users → (your account) — it is only shown here, once.')
  } else {
    logger.info({}, '(User already existed — no new password generated.)')
  }

  await disconnectDatabase()
}

main().catch((err) => {
  logger.error({}, `Bootstrap failed: ${err instanceof Error ? err.stack : String(err)}`)
  process.exitCode = 1
})
