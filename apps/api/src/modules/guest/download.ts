import { DEFAULTS } from '@neoteric-memories/shared'
import { getPrisma } from '../../db.js'
import { Errors } from '../../lib/errors.js'
import { getStorageProvider } from '../../providers/storage/index.js'
import { enqueueJob } from '../../jobs/queue.js'
import { claimAndRunScopedJob, type ScopedJobResult } from '../../jobs/loop.js'

/** Only photoIds that actually appear in this guest's own completed search results are ever eligible — guests can never request an arbitrary event photoId (IDOR guard). */
async function eligiblePhotoIds(searchId: string, guestSessionId: string): Promise<string[]> {
  const prisma = getPrisma()
  const search = await prisma.faceSearch.findUnique({ where: { id: searchId } })
  if (!search || search.guestSessionId !== guestSessionId) throw Errors.forbidden('That search does not belong to your session')
  const matches = await prisma.faceMatch.findMany({ where: { faceSearchId: searchId }, select: { photoId: true } })
  return matches.map((m) => m.photoId)
}

export async function getSinglePhotoDownloadUrl(searchId: string, guestSessionId: string, photoId: string): Promise<string> {
  const eligible = await eligiblePhotoIds(searchId, guestSessionId)
  if (!eligible.includes(photoId)) throw Errors.forbidden('That photo is not part of your search results')

  const prisma = getPrisma()
  const photo = await prisma.photo.findUnique({ where: { id: photoId } })
  if (!photo || photo.deletedAt || photo.isArchived) throw Errors.notFound('Photo is no longer available')

  const key = photo.previewKey ?? photo.originalKey
  return getStorageProvider().getSignedDownloadUrl(key, DEFAULTS.SIGNED_URL_TTL_MINUTES * 60, {
    downloadFilename: `neoteric-memories-${photo.id}.jpg`,
  })
}

export async function createZipDownloadJob(
  searchId: string,
  guestSessionId: string,
  requestedPhotoIds: string[] | undefined
): Promise<string> {
  const eligible = await eligiblePhotoIds(searchId, guestSessionId)
  const targetIds = requestedPhotoIds && requestedPhotoIds.length > 0 ? requestedPhotoIds.filter((id) => eligible.includes(id)) : eligible
  if (targetIds.length === 0) throw Errors.badRequest('No eligible photos to download')

  const prisma = getPrisma()
  const job = await prisma.downloadJob.create({
    data: {
      guestSessionId,
      faceSearchId: searchId,
      photoIds: targetIds,
      type: 'ZIP',
      status: 'PENDING',
      signedUrlExpiresAt: new Date(Date.now() + DEFAULTS.GALLERY_ACCESS_TTL_HOURS * 60 * 60 * 1000),
    },
  })
  await enqueueJob('ZIP_GENERATE', { downloadJobId: job.id }, `zip-generate:${job.id}`)
  return job.id
}

/**
 * Claims and runs this guest's own ZIP_GENERATE job right now, instead of waiting for
 * the GitHub Actions recovery cron's next tick (see .github/workflows/backend-cron.yml
 * — a free, but not promptly-timed, backstop) or a persistent worker (not run on the
 * Vercel deployment — see api/index.js). Ownership is checked the same way
 * getDownloadJobStatus already does: this only ever touches a job belonging to the
 * guestSessionId making the request, via claimAndRunScopedJob's exact-payload-match
 * scoping (downloadJobId) — a guest can never trigger or observe another guest's
 * download job this way.
 */
export async function processZipDownloadJobNow(downloadJobId: string, guestSessionId: string): Promise<ScopedJobResult> {
  const prisma = getPrisma()
  const job = await prisma.downloadJob.findUnique({ where: { id: downloadJobId } })
  if (!job || job.guestSessionId !== guestSessionId) throw Errors.notFound('Download not found')
  return claimAndRunScopedJob({ types: ['ZIP_GENERATE'], match: { downloadJobId } })
}

export async function getDownloadJobStatus(downloadJobId: string, guestSessionId: string) {
  const prisma = getPrisma()
  const job = await prisma.downloadJob.findUnique({ where: { id: downloadJobId } })
  if (!job || job.guestSessionId !== guestSessionId) throw Errors.notFound('Download not found')

  if (job.status !== 'COMPLETED' || !job.zipKey) {
    return { status: job.status, url: null as string | null, errorMessage: job.errorMessage }
  }
  const url = await getStorageProvider().getSignedDownloadUrl(job.zipKey, DEFAULTS.SIGNED_URL_TTL_MINUTES * 60, {
    downloadFilename: 'neoteric-memories-photos.zip',
  })
  return { status: job.status, url, errorMessage: null as string | null }
}
