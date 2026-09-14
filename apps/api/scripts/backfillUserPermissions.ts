// One-time (but safe to re-run — idempotent) backfill for the per-user permission
// matrix feature: sets User.permissions from that user's role's reference default
// set (packages/shared/src/rbac.ts's ROLE_PERMISSIONS) for every user that doesn't
// already have a non-empty permissions array, so nobody's real-world access changes
// the moment enforcement switches from role-derived to per-user (requirePermission
// now checks User.permissions directly, not the role — see hasUserPermission).
//
// Run this against your real database once, after deploying the schema change and
// before (or immediately after) deploying the code that enforces per-user
// permissions:
//   npx tsx scripts/backfillUserPermissions.ts
import { ROLE_PERMISSIONS } from '@neoteric-memories/shared'
import { connectDatabase, disconnectDatabase, getPrisma } from '../src/db.js'
import { logger } from '../src/lib/logger.js'

async function main() {
  await connectDatabase()
  const prisma = getPrisma()

  const users = await prisma.user.findMany()
  let updated = 0
  let skipped = 0

  for (const user of users) {
    if (user.permissions.length > 0) {
      skipped += 1
      continue
    }
    const defaults = ROLE_PERMISSIONS[user.role]
    await prisma.user.update({ where: { id: user.id }, data: { permissions: [...defaults] } })
    logger.info({ userId: user.id, email: user.email, role: user.role, grantedCount: defaults.length }, 'Backfilled permissions from role default')
    updated += 1
  }

  logger.info({}, `Done — ${updated} user(s) backfilled, ${skipped} already had permissions and were left untouched.`)
  await disconnectDatabase()
}

main().catch((err) => {
  logger.error({}, `Backfill failed: ${err instanceof Error ? err.stack : String(err)}`)
  process.exitCode = 1
})
