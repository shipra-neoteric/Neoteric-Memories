import { Router } from 'express'
import { z } from 'zod'
import { retentionPolicySchema, objectIdSchema } from '@neoteric-memories/shared'
import { asyncHandler } from '../../middleware/asyncHandler.js'
import { validateBody, validateParams } from '../../middleware/validate.js'
import { requirePermission } from '../../middleware/rbac.js'
import { getPrisma } from '../../db.js'
import { writeAuditLog } from '../audit/service.js'
import { runRetentionSweep } from '../../jobs/processors/retentionSweep.js'

export const retentionRouter = Router()
const idParams = z.object({ id: objectIdSchema })

retentionRouter.get(
  '/',
  requirePermission('retention:manage'),
  asyncHandler(async (_req, res) => {
    const policies = await getPrisma().retentionPolicy.findMany({ orderBy: { createdAt: 'desc' } })
    res.json({ retentionPolicies: policies })
  })
)

retentionRouter.post(
  '/',
  requirePermission('retention:manage'),
  validateBody(retentionPolicySchema),
  asyncHandler(async (req, res) => {
    const prisma = getPrisma()
    if (req.body.isDefault) {
      await prisma.retentionPolicy.updateMany({ where: { isDefault: true }, data: { isDefault: false } })
    }
    const policy = await prisma.retentionPolicy.create({ data: req.body })
    await writeAuditLog({ actorId: req.user!.id, actorRole: req.user!.role, action: 'retention_policy.create', entityType: 'RetentionPolicy', entityId: policy.id })
    res.status(201).json({ retentionPolicy: policy })
  })
)

retentionRouter.patch(
  '/:id',
  requirePermission('retention:manage'),
  validateParams(idParams),
  validateBody(retentionPolicySchema.partial()),
  asyncHandler(async (req, res) => {
    const prisma = getPrisma()
    if (req.body.isDefault) {
      await prisma.retentionPolicy.updateMany({ where: { isDefault: true }, data: { isDefault: false } })
    }
    const policy = await prisma.retentionPolicy.update({ where: { id: req.params.id }, data: req.body })
    await writeAuditLog({ actorId: req.user!.id, actorRole: req.user!.role, action: 'retention_policy.update', entityType: 'RetentionPolicy', entityId: policy.id })
    res.json({ retentionPolicy: policy })
  })
)

retentionRouter.post(
  '/run-now',
  requirePermission('retention:manage'),
  asyncHandler(async (req, res) => {
    const result = await runRetentionSweep()
    await writeAuditLog({ actorId: req.user!.id, actorRole: req.user!.role, action: 'retention.manual_run', entityType: 'System', metadata: { ...result } })
    res.json({ result })
  })
)
