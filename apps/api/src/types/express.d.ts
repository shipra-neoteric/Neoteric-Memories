import type { Role } from '@neoteric-memories/shared'

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string
        role: Role
        name: string
      }
      guestSessionId?: string
      requestIpHash?: string
    }
  }
}

export {}
