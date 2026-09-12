import { z } from 'zod'
import { EVENT_TYPES } from '../constants.js'
import { objectIdSchema } from './common.js'

export const eventCreateSchema = z.object({
  name: z.string().min(3).max(150),
  type: z.enum(EVENT_TYPES),
  siteId: objectIdSchema,
  venue: z.string().min(2).max(200),
  description: z.string().max(2000).optional(),
  startAt: z.coerce.date(),
  endAt: z.coerce.date(),
  guestAccessOpensAt: z.coerce.date(),
  guestAccessExpiresAt: z.coerce.date(),
  faceIndexDeleteAt: z.coerce.date(),
  originalPhotoRetentionUntil: z.coerce.date(),
  consentVersionId: objectIdSchema.optional(),
  matchThreshold: z.number().min(50).max(100).optional(),
  likelyIncludesChildren: z.boolean().default(false),
  guardianAssistedFlow: z.boolean().default(false),
  selfieUploadFallbackEnabled: z.boolean().default(false),
})
export type EventCreateInput = z.infer<typeof eventCreateSchema>

export const eventUpdateSchema = eventCreateSchema.partial().extend({ siteId: objectIdSchema.optional() })
export type EventUpdateInput = z.infer<typeof eventUpdateSchema>

export const eventAssignmentSchema = z.object({
  userId: objectIdSchema,
  role: z.enum(['EVENT_MANAGER', 'PHOTOGRAPHER']),
})
export type EventAssignmentInput = z.infer<typeof eventAssignmentSchema>

export const eventStatusTransitionSchema = z.object({
  status: z.enum(['LIVE', 'PAUSED', 'CLOSED', 'ARCHIVED']),
  reason: z.string().max(500).optional(),
})
export type EventStatusTransitionInput = z.infer<typeof eventStatusTransitionSchema>
