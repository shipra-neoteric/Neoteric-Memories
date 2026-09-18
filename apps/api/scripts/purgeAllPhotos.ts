// DESTRUCTIVE, IRREVERSIBLE. Permanently deletes every Photo document across every
// event -- active AND already soft-deleted -- along with their face-index entries
// (both the provider's own index and the IndexedFace rows) and their storage objects
// (original/thumbnail/preview). This is not the same as the admin UI's "Delete all
// photos" button, which only soft-deletes an event's currently-active photos; this
// script also purges the DB rows themselves and any legacy soft-deleted leftovers,
// across every event in the database.
//
// Run this against your real database only when you actually want every photo
// gone, for every event:
//   npx tsx scripts/purgeAllPhotos.ts
import { connectDatabase, disconnectDatabase, getPrisma } from '../src/db.js'
import { getStorageProvider } from '../src/providers/storage/index.js'
import { getFaceSearchProvider } from '../src/providers/faceSearch/index.js'
import { logger } from '../src/lib/logger.js'

const CONCURRENCY = 10

async function runInChunks<T>(items: T[], fn: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    await Promise.all(items.slice(i, i + CONCURRENCY).map(fn))
  }
}

async function main() {
  await connectDatabase()
  const prisma = getPrisma()
  const storage = getStorageProvider()
  const faceSearch = getFaceSearchProvider()

  const photos = await prisma.photo.findMany()
  logger.info({ count: photos.length }, `Found ${photos.length} photo row(s) across all events — purging`)

  let facesRemoved = 0
  let storageObjectsDeleted = 0

  await runInChunks(photos, async (photo) => {
    const indexedFaces = await prisma.indexedFace.findMany({ where: { photoId: photo.id } })
    if (indexedFaces.length > 0) {
      await faceSearch.removePhotoFaces({
        eventId: photo.eventId,
        photoId: photo.id,
        providerFaceIds: indexedFaces.map((f) => f.providerFaceId),
      })
      await prisma.indexedFace.deleteMany({ where: { photoId: photo.id } })
      facesRemoved += indexedFaces.length
    }

    const keys = [photo.originalKey, photo.thumbnailKey, photo.previewKey].filter((k): k is string => !!k)
    if (keys.length > 0) {
      await storage.deleteObjects(keys)
      storageObjectsDeleted += keys.length
    }
  })

  const result = await prisma.photo.deleteMany({})

  logger.info(
    { photosDeleted: result.count, facesRemoved, storageObjectsDeleted },
    `Done — ${result.count} photo row(s) deleted, ${facesRemoved} indexed face(s) removed, ${storageObjectsDeleted} storage object(s) deleted.`
  )
  await disconnectDatabase()
}

main().catch((err) => {
  logger.error({}, `Purge failed: ${err instanceof Error ? err.stack : String(err)}`)
  process.exitCode = 1
})
