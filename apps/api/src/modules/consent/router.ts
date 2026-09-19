import { Router } from 'express'
import { z } from 'zod'
import { consentVersionCreateSchema, objectIdSchema } from '@neoteric-memories/shared'
import { asyncHandler } from '../../middleware/asyncHandler.js'
import { validateBody, validateParams } from '../../middleware/validate.js'
import { requirePermission } from '../../middleware/rbac.js'
import { getPrisma } from '../../db.js'
import { writeAuditLog } from '../audit/service.js'

export const consentRouter = Router()
const idParams = z.object({ id: objectIdSchema })

consentRouter.get(
  '/',
  requirePermission('consent:manage'),
  asyncHandler(async (_req, res) => {
    const versions = await getPrisma().consentVersion.findMany({ orderBy: { createdAt: 'desc' } })
    res.json({ consentVersions: versions })
  })
)

consentRouter.post(
  '/',
  requirePermission('consent:manage'),
  validateBody(consentVersionCreateSchema),
  asyncHandler(async (req, res) => {
    const version = await getPrisma().consentVersion.create({ data: req.body })
    await writeAuditLog({
      actorId: req.user!.id,
      actorRole: req.user!.role,
      action: 'consent_version.create',
      entityType: 'ConsentVersion',
      entityId: version.id,
    })
    res.status(201).json({ consentVersion: version })
  })
)

// Edits an existing version's label/wording/on-off item selection in place —
// distinct from creating a new version. This is fine only because the consent flow
// is still marked DRAFT throughout the admin UI (pending legal review): once a
// version has real legal sign-off, editing it after guests have already accepted it
// would retroactively change what their existing ConsentRecord rows mean, which is
// why versioning (not editing) is normally the right model. isActive is
// deliberately not editable here — that's deactivate's job, kept separate so it
// can't be changed by accident while editing wording.
consentRouter.patch(
  '/:id',
  requirePermission('consent:manage'),
  validateParams(idParams),
  validateBody(consentVersionCreateSchema),
  asyncHandler(async (req, res) => {
    const version = await getPrisma().consentVersion.update({
      where: { id: req.params.id },
      data: { label: req.body.label, requiredText: req.body.requiredText, optionalText: req.body.optionalText },
    })
    await writeAuditLog({
      actorId: req.user!.id,
      actorRole: req.user!.role,
      action: 'consent_version.update',
      entityType: 'ConsentVersion',
      entityId: version.id,
    })
    res.json({ consentVersion: version })
  })
)

consentRouter.patch(
  '/:id/deactivate',
  requirePermission('consent:manage'),
  validateParams(idParams),
  asyncHandler(async (req, res) => {
    const version = await getPrisma().consentVersion.update({ where: { id: req.params.id }, data: { isActive: false } })
    await writeAuditLog({
      actorId: req.user!.id,
      actorRole: req.user!.role,
      action: 'consent_version.deactivate',
      entityType: 'ConsentVersion',
      entityId: version.id,
    })
    res.json({ consentVersion: version })
  })
)
