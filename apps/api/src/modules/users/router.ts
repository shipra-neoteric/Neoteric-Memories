import { Router } from 'express'
import { z } from 'zod'
import { userCreateSchema, userUpdateSchema, objectIdSchema } from '@neoteric-memories/shared'
import { asyncHandler } from '../../middleware/asyncHandler.js'
import { validateBody, validateParams } from '../../middleware/validate.js'
import { requirePermission } from '../../middleware/rbac.js'
import { getPrisma } from '../../db.js'
import { Errors } from '../../lib/errors.js'
import { hashPassword } from '../../lib/password.js'
import { writeAuditLog } from '../audit/service.js'

export const usersRouter = Router()
const idParams = z.object({ id: objectIdSchema })

function toSafeUser(u: { id: string; name: string; email: string; role: string; isActive: boolean; createdAt: Date }) {
  return { id: u.id, name: u.name, email: u.email, role: u.role, isActive: u.isActive, createdAt: u.createdAt }
}

usersRouter.get(
  '/',
  requirePermission('user:manage'),
  asyncHandler(async (_req, res) => {
    const users = await getPrisma().user.findMany({ orderBy: { name: 'asc' } })
    res.json({ users: users.map(toSafeUser) })
  })
)

usersRouter.post(
  '/',
  requirePermission('user:manage'),
  validateBody(userCreateSchema),
  asyncHandler(async (req, res) => {
    const prisma = getPrisma()
    const existing = await prisma.user.findUnique({ where: { email: req.body.email.toLowerCase() } })
    if (existing) throw Errors.conflict('A user with this email already exists')

    const passwordHash = await hashPassword(req.body.password)
    const user = await prisma.user.create({
      data: {
        name: req.body.name,
        email: req.body.email.toLowerCase(),
        passwordHash,
        role: req.body.role,
        isActive: req.body.isActive,
      },
    })
    if (req.body.siteIds?.length) {
      await prisma.userSiteAccess.createMany({
        data: req.body.siteIds.map((siteId: string) => ({ userId: user.id, siteId })),
      })
    }
    await writeAuditLog({ actorId: req.user!.id, actorRole: req.user!.role, action: 'user.create', entityType: 'User', entityId: user.id })
    res.status(201).json({ user: toSafeUser(user) })
  })
)

usersRouter.patch(
  '/:id',
  requirePermission('user:manage'),
  validateParams(idParams),
  validateBody(userUpdateSchema),
  asyncHandler(async (req, res) => {
    const prisma = getPrisma()
    const { siteIds, password, email, ...rest } = req.body
    const data: Record<string, unknown> = { ...rest }
    if (email) data.email = email.toLowerCase()
    if (password) data.passwordHash = await hashPassword(password)

    const user = await prisma.user.update({ where: { id: req.params.id }, data })

    if (siteIds) {
      await prisma.userSiteAccess.deleteMany({ where: { userId: user.id } })
      if (siteIds.length > 0) {
        await prisma.userSiteAccess.createMany({ data: siteIds.map((siteId: string) => ({ userId: user.id, siteId })) })
      }
    }
    await writeAuditLog({ actorId: req.user!.id, actorRole: req.user!.role, action: 'user.update', entityType: 'User', entityId: user.id })
    res.json({ user: toSafeUser(user) })
  })
)

usersRouter.get(
  '/:id/site-access',
  requirePermission('user:manage'),
  validateParams(idParams),
  asyncHandler(async (req, res) => {
    const access = await getPrisma().userSiteAccess.findMany({ where: { userId: req.params.id } })
    res.json({ siteIds: access.map((a) => a.siteId) })
  })
)
