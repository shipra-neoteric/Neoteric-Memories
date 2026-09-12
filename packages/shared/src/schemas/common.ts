import { z } from 'zod'

export const objectIdSchema = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id')

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})
export type Pagination = z.infer<typeof paginationSchema>

export const dateRangeSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
})
