import { z } from 'zod'
import { CONSENT_KEYS } from '../constants.js'

export const consentVersionCreateSchema = z.object({
  label: z.string().min(2).max(150),
  requiredText: z.object({
    [CONSENT_KEYS.REQUIRED_SEARCH]: z.string().min(10),
    [CONSENT_KEYS.REQUIRED_ACCURACY]: z.string().min(10),
    [CONSENT_KEYS.REQUIRED_RETENTION]: z.string().min(10),
  }),
  optionalText: z.object({
    [CONSENT_KEYS.OPTIONAL_CONTACT]: z.string().min(10),
    [CONSENT_KEYS.OPTIONAL_MARKETING_USE]: z.string().min(10),
  }),
  isActive: z.boolean().default(true),
})
export type ConsentVersionCreateInput = z.infer<typeof consentVersionCreateSchema>

export const consentSubmitSchema = z.object({
  required: z.object({
    [CONSENT_KEYS.REQUIRED_SEARCH]: z.literal(true),
    [CONSENT_KEYS.REQUIRED_ACCURACY]: z.literal(true),
    [CONSENT_KEYS.REQUIRED_RETENTION]: z.literal(true),
  }),
  optional: z.object({
    [CONSENT_KEYS.OPTIONAL_CONTACT]: z.boolean().default(false),
    [CONSENT_KEYS.OPTIONAL_MARKETING_USE]: z.boolean().default(false),
  }),
  guardianAssisted: z.boolean().default(false),
})
export type ConsentSubmitInput = z.infer<typeof consentSubmitSchema>
