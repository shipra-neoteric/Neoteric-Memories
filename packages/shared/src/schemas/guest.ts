import { z } from 'zod'
import { objectIdSchema } from './common.js'

export const wrongMatchReportSchema = z.object({
  photoId: objectIdSchema,
  note: z.string().max(500).optional(),
})
export type WrongMatchReportInput = z.infer<typeof wrongMatchReportSchema>

export const downloadRequestSchema = z.object({
  photoIds: z.array(objectIdSchema).min(1).max(200).optional(),
  all: z.boolean().default(false),
})
export type DownloadRequestInput = z.infer<typeof downloadRequestSchema>
