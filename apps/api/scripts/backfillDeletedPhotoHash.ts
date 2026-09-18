// One-time (safe to re-run — idempotent) fix for two related bugs where a photo kept
// occupying its original eventId+fileHash unique slot (schema.prisma's
// @@unique([eventId, fileHash])) even though the app itself could no longer see it,
// so re-uploading the exact same file was permanently (and silently, before the
// per-file P2002 handling in processAcceptedFiles) misreported as a duplicate/failure:
//
//   1. A soft-deleted photo whose fileHash predates deletePhoto's mangling fix (see
//      modules/photos/service.ts) — deletedAt is set, but the raw hash was never
//      freed up.
//   2. A photo (deleted OR still active) whose `deletedAt` field predates the fix
//      that made Photo creation always write `deletedAt: null` explicitly. Prisma's
//      MongoDB connector's `{ deletedAt: null }` filter — used everywhere in this
//      app that means "not soft-deleted" (the photo list, classifyUploadBatch's
//      duplicate check, deleteAllPhotosForEvent) — only matches a field that is
//      explicitly present-and-null, NOT one that's simply absent from the document.
//      So a photo missing the field entirely is invisible to every one of those
//      queries, yet still fully occupies its unique slot: an admin sees an empty
//      gallery, "Delete all" can't even find it to remove it, and every re-upload
//      of that exact file 500s/fails forever.
//
// Run this against your real database once, after deploying the relevant fixes:
//   npx tsx scripts/backfillDeletedPhotoHash.ts
import { connectDatabase, disconnectDatabase, getPrisma } from '../src/db.js'
import { logger } from '../src/lib/logger.js'
import { backfillDeletedPhotoHash } from '../src/modules/photos/maintenance.js'

async function main() {
  await connectDatabase()
  const prisma = getPrisma()
  const result = await backfillDeletedPhotoHash(prisma)
  logger.info(
    result,
    `Done — ${result.hashMangled} already-deleted photo(s) had their fileHash freed up, ` +
      `${result.legacyDeletedBackfilled} legacy-deleted photo(s) got a backfilled deletedAt+hash, ` +
      `${result.legacyActiveBackfilled} legacy-active photo(s) got a backfilled deletedAt: null.`
  )
  await disconnectDatabase()
}

main().catch((err) => {
  logger.error({}, `Backfill failed: ${err instanceof Error ? err.stack : String(err)}`)
  process.exitCode = 1
})
