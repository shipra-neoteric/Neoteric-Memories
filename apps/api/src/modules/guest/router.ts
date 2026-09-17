import { Router } from 'express'
import multer from 'multer'
import { z } from 'zod'
import { consentSubmitSchema, downloadRequestSchema, wrongMatchReportSchema, objectIdSchema, DEFAULTS } from '@neoteric-memories/shared'
import { asyncHandler } from '../../middleware/asyncHandler.js'
import { validateBody, validateParams } from '../../middleware/validate.js'
import { requireGuestSessionToken } from '../../middleware/guestAuth.js'
import { guestIpLimiter } from '../../middleware/rateLimit.js'
import { getPrisma } from '../../db.js'
import { Errors } from '../../lib/errors.js'
import { clientDeviceHash, clientIpHash } from '../../lib/request.js'
import { signGuestToken } from '../../lib/guestToken.js'
import { getStorageProvider } from '../../providers/storage/index.js'
import { resolveGuestAccessToken } from '../events/accessTokens.js'
import { getOrCreateGuestSession, requireActiveSession, requireLiveEventForSession, checkAndIncrementSelfieAttempt, checkDeviceSearchLimit } from './session.js'
import { submitConsent, hasValidConsent } from './consent.js'
import { performSelfieSearch, SelfieRejectedError } from './selfieSearch.js'
import { getSinglePhotoDownloadUrl, createZipDownloadJob, getDownloadJobStatus, processZipDownloadJobNow } from './download.js'
import { reportWrongMatch } from './wrongMatch.js'
import { deleteGuestSessionData } from './sessionDeletion.js'

export const guestRouter = Router()
guestRouter.use(guestIpLimiter)

const sessionParams = z.object({ sessionId: objectIdSchema })
const searchParams = z.object({ sessionId: objectIdSchema, searchId: objectIdSchema })
const photoDownloadParams = z.object({ sessionId: objectIdSchema, searchId: objectIdSchema, photoId: objectIdSchema })
const downloadJobParams = z.object({ sessionId: objectIdSchema, downloadJobId: objectIdSchema })

const selfieUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } })

guestRouter.get(
  '/events/:token',
  asyncHandler(async (req, res) => {
    const resolved = await resolveGuestAccessToken(req.params.token)
    if (!resolved.ok) {
      return res.status(200).json({ ok: false, reason: resolved.reason })
    }
    const { event } = resolved
    const prisma = getPrisma()
    const [site, consentVersion] = await Promise.all([
      prisma.site.findUnique({ where: { id: event.siteId } }),
      event.consentVersionId ? prisma.consentVersion.findUnique({ where: { id: event.consentVersionId } }) : null,
    ])

    // The client re-sends its own previous session id (from localStorage) as `sid`
    // instead of a cookie — see the doc comment on requireGuestSessionToken for why.
    const existingSessionId = typeof req.query.sid === 'string' ? req.query.sid : undefined
    const session = await getOrCreateGuestSession(event.id, existingSessionId, {
      ipHash: clientIpHash(req),
      deviceHash: clientDeviceHash(req),
      userAgent: req.header('user-agent'),
    })

    const coverUrl = event.coverImageKey
      ? await getStorageProvider().getSignedDownloadUrl(event.coverImageKey, 3600)
      : null

    res.json({
      ok: true,
      sessionId: session.id,
      sessionToken: signGuestToken(session.id),
      event: {
        id: event.id,
        name: event.name,
        type: event.type,
        venue: event.venue,
        description: event.description,
        startAt: event.startAt,
        endAt: event.endAt,
        guestAccessExpiresAt: event.guestAccessExpiresAt,
        siteName: site?.name,
        coverUrl,
        likelyIncludesChildren: event.likelyIncludesChildren,
        guardianAssistedFlow: event.guardianAssistedFlow,
        selfieUploadFallbackEnabled: event.selfieUploadFallbackEnabled,
      },
      consentVersion,
      consentAlreadyGiven: await hasValidConsent(session.id),
    })
  })
)

guestRouter.post(
  '/sessions/:sessionId/consent',
  validateParams(sessionParams),
  requireGuestSessionToken,
  validateBody(consentSubmitSchema),
  asyncHandler(async (req, res) => {
    const session = await requireActiveSession(req.params.sessionId)
    await requireLiveEventForSession(session.eventId)
    const record = await submitConsent(session.id, session.eventId, req.body, {
      ipHash: clientIpHash(req),
      userAgent: req.header('user-agent'),
    })
    res.status(201).json({ consentRecordId: record.id })
  })
)

guestRouter.post(
  '/sessions/:sessionId/selfie',
  validateParams(sessionParams),
  requireGuestSessionToken,
  selfieUpload.single('selfie'),
  asyncHandler(async (req, res) => {
    const session = await requireActiveSession(req.params.sessionId)
    const event = await requireLiveEventForSession(session.eventId)

    if (!(await hasValidConsent(session.id))) {
      throw Errors.forbidden('Please accept the consent terms before submitting a selfie.')
    }
    if (!event.selfieUploadFallbackEnabled && req.header('x-capture-source') === 'upload') {
      throw Errors.forbidden('Uploading a photo is not enabled for this event — please use the live camera capture.')
    }
    if (!req.file) throw Errors.badRequest('No selfie image was provided')

    await checkAndIncrementSelfieAttempt(session.id)
    await checkDeviceSearchLimit(session.eventId, session.deviceHash)

    try {
      const result = await performSelfieSearch(session.id, session.eventId, req.file.buffer)
      res.status(201).json({ ok: true, ...result })
    } catch (err) {
      if (err instanceof SelfieRejectedError) {
        return res.status(422).json({ ok: false, reason: err.reason, message: err.message })
      }
      throw err
    }
  })
)

guestRouter.get(
  '/sessions/:sessionId/searches/:searchId/results',
  validateParams(searchParams),
  requireGuestSessionToken,
  asyncHandler(async (req, res) => {
    await requireActiveSession(req.params.sessionId)
    const prisma = getPrisma()
    const search = await prisma.faceSearch.findUnique({ where: { id: req.params.searchId } })
    if (!search || search.guestSessionId !== req.params.sessionId) throw Errors.notFound('Search not found')

    const matches = await prisma.faceMatch.findMany({ where: { faceSearchId: search.id }, orderBy: { similarity: 'desc' } })
    const photos = await prisma.photo.findMany({ where: { id: { in: matches.map((m) => m.photoId) }, deletedAt: null, isArchived: false } })
    const photoById = new Map(photos.map((p) => [p.id, p]))

    const storage = getStorageProvider()
    const results = await Promise.all(
      matches
        .filter((m) => photoById.has(m.photoId))
        .map(async (m) => {
          const photo = photoById.get(m.photoId)!
          const thumbUrl = photo.thumbnailKey ? await storage.getSignedDownloadUrl(photo.thumbnailKey, DEFAULTS.SIGNED_URL_TTL_MINUTES * 60) : null
          return { photoId: photo.id, thumbUrl }
        })
    )

    res.json({
      status: search.status,
      resultCount: results.length,
      photos: results,
      disclaimer:
        'Face matching is probabilistic and may not find every photo you appear in, and may occasionally include a photo of someone who looks similar. This is not an identity verification.',
    })
  })
)

guestRouter.post(
  '/sessions/:sessionId/searches/:searchId/report-wrong-match',
  validateParams(searchParams),
  requireGuestSessionToken,
  validateBody(wrongMatchReportSchema),
  asyncHandler(async (req, res) => {
    await requireActiveSession(req.params.sessionId)
    const report = await reportWrongMatch(req.params.searchId, req.params.sessionId, req.body.photoId, req.body.note)
    res.status(201).json({ reportId: report.id })
  })
)

guestRouter.get(
  '/sessions/:sessionId/searches/:searchId/photos/:photoId/download-url',
  validateParams(photoDownloadParams),
  requireGuestSessionToken,
  asyncHandler(async (req, res) => {
    await requireActiveSession(req.params.sessionId)
    const url = await getSinglePhotoDownloadUrl(req.params.searchId, req.params.sessionId, req.params.photoId)
    res.json({ url })
  })
)

guestRouter.post(
  '/sessions/:sessionId/searches/:searchId/download-zip',
  validateParams(searchParams),
  requireGuestSessionToken,
  validateBody(downloadRequestSchema),
  asyncHandler(async (req, res) => {
    await requireActiveSession(req.params.sessionId)
    const downloadJobId = await createZipDownloadJob(req.params.searchId, req.params.sessionId, req.body.all ? undefined : req.body.photoIds)
    res.status(201).json({ downloadJobId })
  })
)

guestRouter.get(
  '/sessions/:sessionId/downloads/:downloadJobId',
  validateParams(downloadJobParams),
  requireGuestSessionToken,
  asyncHandler(async (req, res) => {
    const status = await getDownloadJobStatus(req.params.downloadJobId, req.params.sessionId)
    res.json(status)
  })
)

// Claims and runs this guest's own ZIP_GENERATE job right now, instead of relying
// solely on the GitHub Actions recovery cron's next tick (which, per its own doc
// comment, is a free backstop but not a promise of prompt timing). The guest UI calls
// this once right after creating the download job, same "enqueue, then immediately
// trigger the bounded processor" pattern used by the admin upload/Drive-sync flows —
// see jobs/loop.ts's claimAndRunScopedJob for the shared claiming mechanism and its
// ownership/scoping guarantees.
guestRouter.post(
  '/sessions/:sessionId/downloads/:downloadJobId/process',
  validateParams(downloadJobParams),
  requireGuestSessionToken,
  asyncHandler(async (req, res) => {
    await requireActiveSession(req.params.sessionId)
    const outcome = await processZipDownloadJobNow(req.params.downloadJobId, req.params.sessionId)
    res.json({ processed: outcome.processed, result: outcome.result })
  })
)

guestRouter.delete(
  '/sessions/:sessionId',
  validateParams(sessionParams),
  requireGuestSessionToken,
  asyncHandler(async (req, res) => {
    await deleteGuestSessionData(req.params.sessionId)
    res.json({ success: true })
  })
)
