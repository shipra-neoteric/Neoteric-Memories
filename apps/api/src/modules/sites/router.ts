import { Router } from 'express'
import { z } from 'zod'
import { siteCreateSchema, siteUpdateSchema, objectIdSchema } from '@neoteric-memories/shared'
import { asyncHandler } from '../../middleware/asyncHandler.js'
import { validateBody, validateParams } from '../../middleware/validate.js'
import { requirePermission } from '../../middleware/rbac.js'
import { getPrisma } from '../../db.js'
import { Errors } from '../../lib/errors.js'
import { writeAuditLog } from '../audit/service.js'

export const sitesRouter = Router()

const idParams = z.object({ id: objectIdSchema })

sitesRouter.get(
  '/',
  requirePermission('site:view'),
  asyncHandler(async (req, res) => {
    const prisma = getPrisma()
    if (req.user!.role === 'MASTER_ADMIN') {
      const sites = await prisma.site.findMany({ orderBy: { name: 'asc' } })
      return res.json({ sites })
    }
    const access = await prisma.userSiteAccess.findMany({ where: { userId: req.user!.id } })
    const sites = await prisma.site.findMany({ where: { id: { in: access.map((a) => a.siteId) } }, orderBy: { name: 'asc' } })
    res.json({ sites })
  })
)

sitesRouter.post(
  '/',
  requirePermission('site:manage'),
  validateBody(siteCreateSchema),
  asyncHandler(async (req, res) => {
    const existing = await getPrisma().site.findUnique({ where: { code: req.body.code } })
    if (existing) throw Errors.conflict('A site with this code already exists')
    const site = await getPrisma().site.create({ data: req.body })
    await writeAuditLog({ actorId: req.user!.id, actorRole: req.user!.role, action: 'site.create', entityType: 'Site', entityId: site.id, siteId: site.id })
    res.status(201).json({ site })
  })
)

sitesRouter.patch(
  '/:id',
  requirePermission('site:manage'),
  validateParams(idParams),
  validateBody(siteUpdateSchema),
  asyncHandler(async (req, res) => {
    const site = await getPrisma().site.update({ where: { id: req.params.id }, data: req.body })
    await writeAuditLog({ actorId: req.user!.id, actorRole: req.user!.role, action: 'site.update', entityType: 'Site', entityId: site.id, siteId: site.id })
    res.json({ site })
  })
)
