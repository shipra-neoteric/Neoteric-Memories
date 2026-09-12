import { z } from 'zod'
import { ROLES } from '../constants.js'
import { objectIdSchema } from './common.js'

export const userCreateSchema = z.object({
  name: z.string().min(2).max(120),
  email: z.string().email(),
  password: z.string().min(10).max(200),
  role: z.enum(ROLES),
  siteIds: z.array(objectIdSchema).default([]),
  isActive: z.boolean().default(true),
})
export type UserCreateInput = z.infer<typeof userCreateSchema>

export const userUpdateSchema = userCreateSchema
  .omit({ password: true })
  .partial()
  .extend({ password: z.string().min(10).max(200).optional() })
export type UserUpdateInput = z.infer<typeof userUpdateSchema>
