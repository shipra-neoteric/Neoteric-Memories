import type { getPrisma } from '../../db.js'

/**
 * One-time (safe to re-run — idempotent) fix for two related bugs where a photo kept
 * occupying its original eventId+fileHash unique slot (schema.prisma's
 * @@unique([eventId, fileHash])) even though the app itself could no longer see it,
 * so re-uploading the exact same file was permanently misreported as a
 * duplicate/failure:
 *
 *   1. A soft-deleted photo whose fileHash predates deletePhoto's mangling fix (see
 *      ./service.ts) — deletedAt is set, but the raw hash was never freed up.
 *   2. A photo (deleted OR still active) whose `deletedAt` field predates the fix
 *      that made Photo creation always write `deletedAt: null` explicitly. Prisma's
 *      MongoDB connector's `{ deletedAt: null }` filter — used everywhere in this
 *      app that means "not soft-deleted" (the photo list, classifyUploadBatch's
 *      duplicate check, deleteAllPhotosForEvent) — only matches a field that is
 *      explicitly present-and-null, NOT one that's simply absent from the document.
 *      So a photo missing the field entirely is invisible to every one of those
 *      queries, yet still fully occupies its unique slot: an admin sees an empty
 *      gallery, "Delete all" can't even find it to remove it, and every re-upload of
 *      that exact file fails forever.
 *
 * Callable both from scripts/backfillDeletedPhotoHash.ts (a one-off CLI run against a
 * real database) and from the admin maintenance route (so it can be triggered from an
 * already-authenticated browser session without needing direct DB credentials at all).
 */
export async function backfillDeletedPhotoHash(prisma: ReturnType<typeof getPrisma>) {
  const explicitlyDeleted = await prisma.photo.findMany({
    where: { deletedAt: { not: null }, fileHash: { not: { contains: ':deleted:' } } },
  })
  for (const photo of explicitlyDeleted) {
    await prisma.photo.update({ where: { id: photo.id }, data: { fileHash: `${photo.fileHash}:deleted:${photo.id}` } })
  }

  // Prisma's MongoDB-only `isSet` filter distinguishes "field absent from the
  // document" from "field present and null" — exactly the distinction `deletedAt:
  // null` elsewhere in this codebase can't make (see this file's own doc comment).
  const missingDeletedAt = await prisma.photo.findMany({ where: { deletedAt: { isSet: false } } })
  let legacyDeletedBackfilled = 0
  let legacyActiveBackfilled = 0
  for (const photo of missingDeletedAt) {
    if (photo.status === 'DELETED') {
      // Genuinely deleted, just from before deletedAt was ever written on delete —
      // backfill both fields the same way a delete today would set them.
      await prisma.photo.update({
        where: { id: photo.id },
        data: {
          deletedAt: photo.updatedAt,
          fileHash: photo.fileHash.includes(':deleted:') ? photo.fileHash : `${photo.fileHash}:deleted:${photo.id}`,
        },
      })
      legacyDeletedBackfilled += 1
    } else {
      // Genuinely active, just from before Photo creation always wrote `deletedAt:
      // null` explicitly — backfill the field so it becomes visible to every query
      // that filters on it, without touching anything else about the row.
      await prisma.photo.update({ where: { id: photo.id }, data: { deletedAt: null } })
      legacyActiveBackfilled += 1
    }
  }

  return { hashMangled: explicitlyDeleted.length, legacyDeletedBackfilled, legacyActiveBackfilled }
}
