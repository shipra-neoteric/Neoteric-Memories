import { z } from 'zod'

export const retentionPolicySchema = z.object({
  label: z.string().min(2).max(120),
  guestSessionTtlHours: z.number().int().min(1).max(72),
  galleryAccessTtlHours: z.number().int().min(1).max(72),
  signedUrlTtlMinutes: z.number().int().min(1).max(120),
  selfieMaxRetentionHours: z.number().int().min(1).max(24),
  eventFaceIndexRetentionDays: z.number().int().min(1).max(365),
  isDefault: z.boolean().default(false),
})
export type RetentionPolicyInput = z.infer<typeof retentionPolicySchema>
