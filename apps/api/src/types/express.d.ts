import type { Permission, Role } from '@neoteric-memories/shared'

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string
        role: Role
        name: string
        permissions: Permission[]
      }
      guestSessionId?: string
      requestIpHash?: string
    }
  }
}

export {}
