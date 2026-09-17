// One-time (safe to re-run — idempotent) fix for a bug where soft-deleted photos
// kept occupying their original eventId+fileHash unique slot (schema.prisma's
// @@unique([eventId, fileHash])), so re-uploading the exact same file after it had
// been deleted (e.g. via "Delete all photos") was permanently misreported as a
// duplicate and silently rejected. deletePhoto now mangles fileHash going forward
// (see modules/photos/service.ts) — this backfills every already soft-deleted photo
// that predates that fix, so its original hash is freed up for re-upload.
//
// Run this against your real database once, after deploying the deletePhoto fix:
//   npx tsx scripts/backfillDeletedPhotoHash.ts
import { connectDatabase, disconnectDatabase, getPrisma } from '../src/db.js'
import { logger } from '../src/lib/logger.js'

async function main() {
  await connectDatabase()
  const prisma = getPrisma()

  const photos = await prisma.photo.findMany({
    where: { deletedAt: { not: null }, fileHash: { not: { contains: ':deleted:' } } },
  })

  let updated = 0
  for (const photo of photos) {
    await prisma.photo.update({
      where: { id: photo.id },
      data: { fileHash: `${photo.fileHash}:deleted:${photo.id}` },
    })
    updated += 1
  }

  logger.info({}, `Done — ${updated} already-deleted photo(s) had their fileHash freed up for re-upload.`)
  await disconnectDatabase()
}

main().catch((err) => {
  logger.error({}, `Backfill failed: ${err instanceof Error ? err.stack : String(err)}`)
  process.exitCode = 1
})
