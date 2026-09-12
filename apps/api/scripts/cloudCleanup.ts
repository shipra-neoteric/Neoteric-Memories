/**
 * Permanent, reusable cleanup utility for real S3 objects, real Rekognition
 * collections, and the database rows belonging to a specific, explicit set of
 * eventIds.
 *
 * DEFAULT MODE IS DRY-RUN: it only prints what it would delete.
 *
 * To actually delete anything, you must pass --execute AND set the environment
 * variable DESTRUCTIVE_CLOUD_CLEANUP_CONFIRM to the exact value
 * "yes-delete-real-cloud-and-database-data" — see scripts/lib/destructiveOpsGuard.ts.
 * This script refuses unconditionally to run at all under the Vitest test runtime, so
 * no test can ever invoke it. Nothing in this repo imports this file — it is only ever
 * invoked directly as a CLI. Do not import it from a test.
 *
 * Usage:
 *   tsx scripts/cloudCleanup.ts --input ./cleanup-input.json
 *
 *   DESTRUCTIVE_CLOUD_CLEANUP_CONFIRM=yes-delete-real-cloud-and-database-data \
 *     tsx scripts/cloudCleanup.ts --input ./cleanup-input.json --execute
 *
 * Input JSON shape:
 *   {
 *     "eventIds": ["<mongo ObjectId>", ...],
 *       // deletes every DB row scoped to these eventIds (Photo, PhotoBatch,
 *       // FaceSearch/FaceMatch, IndexedFace, MockFaceIndexEntry, GuestSession,
 *       // ConsentRecord, WrongMatchReport, EventAccessToken, EventAssignment,
 *       // DriveIntegration, and finally the Event itself), and the Rekognition
 *       // collection neoteric-event-<id>.
 *     "s3Keys": ["events/<id>/originals/...", ...]
 *       // exact S3 keys to delete — no bucket listing, so this never requires
 *       // s3:ListBucket permission.
 *   }
 *
 * This intentionally never deletes Site/User/ConsentVersion rows, since those are
 * not intrinsically scoped to an eventId — review and remove those separately (with
 * the same opt-in gate) if a cleanup ever needs to touch them.
 */
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { DeleteCollectionCommand, RekognitionClient, ResourceNotFoundException } from '@aws-sdk/client-rekognition'
import { DeleteObjectsCommand, S3Client } from '@aws-sdk/client-s3'
import { connectDatabase, disconnectDatabase, getPrisma } from '../src/db.js'
import { env } from '../src/env.js'
import { isTestRuntime } from '../src/lib/testGuard.js'
import { resolveDestructiveOpsMode } from './lib/destructiveOpsGuard.js'

interface CleanupInput {
  eventIds?: string[]
  s3Keys?: string[]
}

function eventCollectionId(eventId: string): string {
  return `neoteric-event-${eventId}`
}

function parseInputPath(argv: string[]): string {
  const inputIdx = argv.indexOf('--input')
  const inputPath = inputIdx >= 0 ? argv[inputIdx + 1] : undefined
  if (!inputPath) throw new Error('Usage: tsx scripts/cloudCleanup.ts --input <path.json> [--execute]')
  return inputPath
}

async function deleteRekognitionCollections(eventIds: string[], dryRun: boolean): Promise<void> {
  if (eventIds.length === 0) return
  if (dryRun) {
    for (const eventId of eventIds) console.log(`[dry-run] would delete Rekognition collection ${eventCollectionId(eventId)}`)
    return
  }
  const client = new RekognitionClient({
    region: env.AWS_REGION,
    credentials:
      env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY
        ? { accessKeyId: env.AWS_ACCESS_KEY_ID, secretAccessKey: env.AWS_SECRET_ACCESS_KEY }
        : undefined,
  })
  for (const eventId of eventIds) {
    const collectionId = eventCollectionId(eventId)
    try {
      await client.send(new DeleteCollectionCommand({ CollectionId: collectionId }))
      console.log(`Deleted Rekognition collection ${collectionId}`)
    } catch (err) {
      if (err instanceof ResourceNotFoundException) {
        console.log(`Rekognition collection ${collectionId} already gone`)
      } else {
        throw err
      }
    }
  }
}

async function deleteS3Objects(s3Keys: string[], dryRun: boolean): Promise<void> {
  if (s3Keys.length === 0) return
  if (dryRun) {
    for (const key of s3Keys) console.log(`[dry-run] would delete S3 object ${key}`)
    return
  }
  if (!env.S3_BUCKET) throw new Error('S3_BUCKET must be set to delete S3 objects.')
  const client = new S3Client({
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT,
    forcePathStyle: !!env.S3_ENDPOINT,
    credentials:
      env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
        ? { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY }
        : undefined,
  })
  for (let i = 0; i < s3Keys.length; i += 1000) {
    const chunk = s3Keys.slice(i, i + 1000)
    await client.send(new DeleteObjectsCommand({ Bucket: env.S3_BUCKET, Delete: { Objects: chunk.map((Key) => ({ Key })) } }))
    console.log(`Deleted ${chunk.length} S3 object(s)`)
  }
}

async function deleteDatabaseRows(eventIds: string[], dryRun: boolean): Promise<void> {
  if (eventIds.length === 0) return
  await connectDatabase()
  const prisma = getPrisma()
  try {
    if (dryRun) {
      const counts = {
        Photo: await prisma.photo.count({ where: { eventId: { in: eventIds } } }),
        PhotoBatch: await prisma.photoBatch.count({ where: { eventId: { in: eventIds } } }),
        IndexedFace: await prisma.indexedFace.count({ where: { eventId: { in: eventIds } } }),
        FaceSearch: await prisma.faceSearch.count({ where: { eventId: { in: eventIds } } }),
        GuestSession: await prisma.guestSession.count({ where: { eventId: { in: eventIds } } }),
        ConsentRecord: await prisma.consentRecord.count({ where: { eventId: { in: eventIds } } }),
        WrongMatchReport: await prisma.wrongMatchReport.count({ where: { eventId: { in: eventIds } } }),
        EventAccessToken: await prisma.eventAccessToken.count({ where: { eventId: { in: eventIds } } }),
        EventAssignment: await prisma.eventAssignment.count({ where: { eventId: { in: eventIds } } }),
        DriveIntegration: await prisma.driveIntegration.count({ where: { eventId: { in: eventIds } } }),
        MockFaceIndexEntry: await prisma.mockFaceIndexEntry.count({ where: { eventId: { in: eventIds } } }),
        Event: await prisma.event.count({ where: { id: { in: eventIds } } }),
      }
      for (const [model, count] of Object.entries(counts)) console.log(`[dry-run] would delete ${count} ${model} row(s)`)
      return
    }

    const faceSearches = await prisma.faceSearch.findMany({ where: { eventId: { in: eventIds } }, select: { id: true } })
    const faceSearchIds = faceSearches.map((f) => f.id)
    if (faceSearchIds.length > 0) await prisma.faceMatch.deleteMany({ where: { faceSearchId: { in: faceSearchIds } } })
    await prisma.faceSearch.deleteMany({ where: { eventId: { in: eventIds } } })
    await prisma.indexedFace.deleteMany({ where: { eventId: { in: eventIds } } })
    await prisma.mockFaceIndexEntry.deleteMany({ where: { eventId: { in: eventIds } } })
    await prisma.consentRecord.deleteMany({ where: { eventId: { in: eventIds } } })
    await prisma.guestSession.deleteMany({ where: { eventId: { in: eventIds } } })
    await prisma.wrongMatchReport.deleteMany({ where: { eventId: { in: eventIds } } })
    await prisma.photo.deleteMany({ where: { eventId: { in: eventIds } } })
    await prisma.photoBatch.deleteMany({ where: { eventId: { in: eventIds } } })
    await prisma.eventAccessToken.deleteMany({ where: { eventId: { in: eventIds } } })
    await prisma.eventAssignment.deleteMany({ where: { eventId: { in: eventIds } } })
    await prisma.driveIntegration.deleteMany({ where: { eventId: { in: eventIds } } })
    const deletedEvents = await prisma.event.deleteMany({ where: { id: { in: eventIds } } })
    console.log(`Deleted database rows for ${deletedEvents.count} event(s)`)
  } finally {
    await disconnectDatabase()
  }
}

export async function main(): Promise<void> {
  if (isTestRuntime()) throw new Error('Refusing to run under the Vitest test runtime.')

  const argv = process.argv.slice(2)
  const inputPath = parseInputPath(argv)
  const { dryRun } = resolveDestructiveOpsMode(argv)
  const input: CleanupInput = JSON.parse(readFileSync(inputPath, 'utf-8'))
  const eventIds = input.eventIds ?? []
  const s3Keys = input.s3Keys ?? []

  console.log(`Mode: ${dryRun ? 'DRY RUN (nothing will be deleted)' : 'EXECUTE (will permanently delete real data)'}`)
  console.log(`Event IDs: ${eventIds.length}, S3 keys: ${s3Keys.length}`)

  await deleteRekognitionCollections(eventIds, dryRun)
  await deleteS3Objects(s3Keys, dryRun)
  await deleteDatabaseRows(eventIds, dryRun)

  console.log(
    dryRun
      ? '\nDry run complete. Nothing was deleted. Re-run with --execute and DESTRUCTIVE_CLOUD_CLEANUP_CONFIRM set to actually delete.'
      : '\nExecute run complete. Real data was permanently deleted.'
  )
}

// Only run when this file is invoked directly (`tsx scripts/cloudCleanup.ts`) — never
// on import, so accidentally importing this module (e.g. from a test) cannot trigger it.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
}
