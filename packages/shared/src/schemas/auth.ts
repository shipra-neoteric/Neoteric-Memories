import { z } from 'zod'

// Must stay no-stricter than userCreateSchema/userUpdateSchema's password rule (see
// schemas/user.ts) — otherwise a validly-created short password could never log in.
const passwordSchema = z.string().min(1).max(200)

export const loginSchema = z.object({
  email: z.string().email(),
  password: passwordSchema,
})
export type LoginInput = z.infer<typeof loginSchema>

export const changePasswordSchema = z.object({
  currentPassword: passwordSchema,
  newPassword: passwordSchema,
})
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>
