import { z } from 'zod'
import { ROLES } from '../constants.js'
import { PERMISSIONS } from '../rbac.js'
import { objectIdSchema } from './common.js'

// No meaningful minimum by design (any non-empty password is accepted) — the
// 200-char cap is a sanity/DoS guard, not a complexity rule; see docs/RBAC.md.
const passwordSchema = z.string().min(1).max(200)

export const userCreateSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email(),
  password: passwordSchema,
  role: z.enum(ROLES),
  siteIds: z.array(objectIdSchema).default([]),
  permissions: z.array(z.enum(PERMISSIONS)).default([]),
  isActive: z.boolean().default(true),
})
export type UserCreateInput = z.infer<typeof userCreateSchema>

export const userUpdateSchema = userCreateSchema
  .omit({ password: true })
  .partial()
  .extend({ password: passwordSchema.optional() })
export type UserUpdateInput = z.infer<typeof userUpdateSchema>
