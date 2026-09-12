import { Router } from 'express'
import { z } from 'zod'
import { paginationSchema } from '@neoteric-memories/shared'
import { asyncHandler } from '../../middleware/asyncHandler.js'
import { validateQuery } from '../../middleware/validate.js'
import { requirePermission } from '../../middleware/rbac.js'
import { getPrisma } from '../../db.js'

export const auditRouter = Router()

const auditQuery = paginationSchema.extend({
  entityType: z.string().optional(),
  eventId: z.string().optional(),
})

auditRouter.get(
  '/logs',
  requirePermission('audit:view'),
  validateQuery(auditQuery),
  asyncHandler(async (req, res) => {
    const { page, pageSize, entityType, eventId } = req.query as unknown as z.infer<typeof auditQuery>
    const where = { ...(entityType ? { entityType } : {}), ...(eventId ? { eventId } : {}) }
    const [logs, total] = await Promise.all([
      getPrisma().auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      getPrisma().auditLog.count({ where }),
    ])
    res.json({ logs, total, page, pageSize })
  })
)

auditRouter.get(
  '/security-events',
  requirePermission('audit:view'),
  validateQuery(paginationSchema),
  asyncHandler(async (req, res) => {
    const { page, pageSize } = req.query as unknown as z.infer<typeof paginationSchema>
    const [events, total] = await Promise.all([
      getPrisma().securityEvent.findMany({ orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      getPrisma().securityEvent.count(),
    ])
    res.json({ events, total, page, pageSize })
  })
)
