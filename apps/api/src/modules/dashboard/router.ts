import { Router } from 'express'
import { asyncHandler } from '../../middleware/asyncHandler.js'
import { requirePermission } from '../../middleware/rbac.js'
import { getPrisma } from '../../db.js'
import { scopedEventWhere } from '../events/scoping.js'

export const dashboardRouter = Router()

dashboardRouter.get(
  '/',
  requirePermission('analytics:view'),
  asyncHandler(async (req, res) => {
    const prisma = getPrisma()
    const where = await scopedEventWhere(req.user!)
    const events = await prisma.event.findMany({ where })
    const eventIds = events.map((e) => e.id)

    const now = new Date()
    const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

    const scopedSearches = await prisma.faceSearch.findMany({ where: { eventId: { in: eventIds } }, select: { id: true } })
    const scopedSearchIds = scopedSearches.map((s) => s.id)

    const [
      totalPhotos,
      processingQueue,
      processedPhotos,
      failedPhotos,
      totalSearches,
      successfulSearches,
      noResultSearches,
      completedDownloads,
      openWrongMatchReports,
    ] = await Promise.all([
      prisma.photo.count({ where: { eventId: { in: eventIds }, deletedAt: null } }),
      prisma.photo.count({ where: { eventId: { in: eventIds }, status: { in: ['PENDING', 'PROCESSING'] }, deletedAt: null } }),
      prisma.photo.count({ where: { eventId: { in: eventIds }, status: 'PROCESSED', deletedAt: null } }),
      prisma.photo.count({ where: { eventId: { in: eventIds }, status: 'FAILED', deletedAt: null } }),
      prisma.faceSearch.count({ where: { eventId: { in: eventIds }, status: 'COMPLETED' } }),
      prisma.faceSearch.count({ where: { eventId: { in: eventIds }, status: 'COMPLETED', resultCount: { gt: 0 } } }),
      prisma.faceSearch.count({ where: { eventId: { in: eventIds }, status: 'COMPLETED', resultCount: 0 } }),
      prisma.downloadJob.count({ where: { status: 'COMPLETED', faceSearchId: { in: scopedSearchIds } } }),
      prisma.wrongMatchReport.count({ where: { eventId: { in: eventIds }, status: 'OPEN' } }),
    ])

    const activeEvents = events.filter((e) => e.status === 'LIVE').length
    const upcomingEvents = events.filter((e) => e.startAt > now).length
    const eventsNearingExpiry = events.filter((e) => e.status === 'LIVE' && e.guestAccessExpiresAt <= in7Days && e.guestAccessExpiresAt > now)

    const storageUsageBytes = await prisma.photo.aggregate({
      where: { eventId: { in: eventIds }, deletedAt: null },
      _sum: { sizeBytes: true },
    })

    res.json({
      activeEvents,
      upcomingEvents,
      totalEvents: events.length,
      totalPhotos,
      processingQueue,
      processedPhotos,
      failedPhotos,
      totalSearches,
      successfulSearches,
      noResultSearches,
      completedDownloads,
      openWrongMatchReports,
      storageUsageBytes: storageUsageBytes._sum.sizeBytes ?? 0,
      eventsNearingExpiry: eventsNearingExpiry.map((e) => ({ id: e.id, name: e.name, guestAccessExpiresAt: e.guestAccessExpiresAt })),
    })
  })
)
