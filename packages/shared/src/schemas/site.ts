import { z } from 'zod'

export const siteCreateSchema = z.object({
  name: z.string().min(2).max(120),
  code: z
    .string()
    .min(2)
    .max(20)
    .regex(/^[A-Z0-9_-]+$/, 'Uppercase letters, numbers, - and _ only'),
  address: z.string().max(300).optional(),
  city: z.string().max(120).optional(),
  isActive: z.boolean().default(true),
})
export type SiteCreateInput = z.infer<typeof siteCreateSchema>

export const siteUpdateSchema = siteCreateSchema.partial()
export type SiteUpdateInput = z.infer<typeof siteUpdateSchema>
