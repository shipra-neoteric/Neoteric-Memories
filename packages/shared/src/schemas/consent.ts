import { z } from 'zod'
import { CONSENT_KEYS } from '../constants.js'

// Each of the 5 known consent items is individually optional here — an admin can
// choose, per consent version, which ones actually apply to that event (e.g. skip
// the marketing-contact item entirely) by simply leaving its text blank. Which keys
// end up PRESENT on a given version is what actually decides what a guest must
// accept — see submitConsent's own doc comment for the enforcement side of this.
export const consentVersionCreateSchema = z.object({
  label: z.string().min(2).max(150),
  requiredText: z
    .object({
      [CONSENT_KEYS.REQUIRED_SEARCH]: z.string().min(10).optional(),
      [CONSENT_KEYS.REQUIRED_ACCURACY]: z.string().min(10).optional(),
      [CONSENT_KEYS.REQUIRED_RETENTION]: z.string().min(10).optional(),
    })
    .refine((v) => Object.keys(v).length > 0, { message: 'Select at least one required consent item' }),
  optionalText: z.object({
    [CONSENT_KEYS.OPTIONAL_CONTACT]: z.string().min(10).optional(),
    [CONSENT_KEYS.OPTIONAL_MARKETING_USE]: z.string().min(10).optional(),
  }),
  isActive: z.boolean().default(true),
})
export type ConsentVersionCreateInput = z.infer<typeof consentVersionCreateSchema>

// Every item is optional at the schema level (any subset of the 5 keys, in whatever
// combination the guest's specific consent version actually presented) — the real
// "was everything this version requires actually accepted" check happens in
// submitConsent, against that version's own requiredText keys, since a fixed zod
// shape here can't know which keys a given version enabled.
export const consentSubmitSchema = z.object({
  required: z.object({
    [CONSENT_KEYS.REQUIRED_SEARCH]: z.boolean().optional(),
    [CONSENT_KEYS.REQUIRED_ACCURACY]: z.boolean().optional(),
    [CONSENT_KEYS.REQUIRED_RETENTION]: z.boolean().optional(),
  }),
  optional: z.object({
    [CONSENT_KEYS.OPTIONAL_CONTACT]: z.boolean().default(false),
    [CONSENT_KEYS.OPTIONAL_MARKETING_USE]: z.boolean().default(false),
  }),
  guardianAssisted: z.boolean().default(false),
})
export type ConsentSubmitInput = z.infer<typeof consentSubmitSchema>
