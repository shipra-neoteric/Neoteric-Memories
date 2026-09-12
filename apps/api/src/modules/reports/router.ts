import { Router } from 'express'
import { z } from 'zod'
import { objectIdSchema, paginationSchema } from '@neoteric-memories/shared'
import { asyncHandler } from '../../middleware/asyncHandler.js'
import { validateBody, validateParams, validateQuery } from '../../middleware/validate.js'
import { requirePermission } from '../../middleware/rbac.js'
import { getPrisma } from '../../db.js'
import { scopedEventWhere } from '../events/scoping.js'
import { writeAuditLog } from '../audit/service.js'

export const reportsRouter = Router()
const idParams = z.object({ id: objectIdSchema })

const listQuery = paginationSchema.extend({ status: z.enum(['OPEN', 'REVIEWED', 'DISMISSED']).optional() })

reportsRouter.get(
  '/',
  requirePermission('report:view'),
  validateQuery(listQuery),
  asyncHandler(async (req, res) => {
    const prisma = getPrisma()
    const { page, pageSize, status } = req.query as unknown as z.infer<typeof listQuery>
    const eventWhere = await scopedEventWhere(req.user!)
    const scopedEvents = await prisma.event.findMany({ where: eventWhere, select: { id: true, name: true } })
    const eventIds = scopedEvents.map((e) => e.id)
    const eventNameById = new Map(scopedEvents.map((e) => [e.id, e.name]))

    const where = { eventId: { in: eventIds }, ...(status ? { status } : {}) }
    const [reports, total] = await Promise.all([
      prisma.wrongMatchReport.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      prisma.wrongMatchReport.count({ where }),
    ])
    res.json({
      reports: reports.map((r) => ({ ...r, eventName: eventNameById.get(r.eventId) })),
      total,
      page,
      pageSize,
    })
  })
)

reportsRouter.patch(
  '/:id/resolve',
  requirePermission('report:resolve'),
  validateParams(idParams),
  validateBody(z.object({ status: z.enum(['REVIEWED', 'DISMISSED']) })),
  asyncHandler(async (req, res) => {
    const report = await getPrisma().wrongMatchReport.update({
      where: { id: req.params.id },
      data: { status: req.body.status, reviewedById: req.user!.id, reviewedAt: new Date() },
    })
    await writeAuditLog({ actorId: req.user!.id, actorRole: req.user!.role, action: 'wrong_match_report.resolve', entityType: 'WrongMatchReport', entityId: report.id, eventId: report.eventId })
    res.json({ report })
  })
)
