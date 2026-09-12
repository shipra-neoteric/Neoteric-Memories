import jwt from 'jsonwebtoken'
import { env } from '../env.js'
import type { Role } from '@neoteric-memories/shared'

export interface AccessTokenPayload {
  sub: string
  role: Role
  name: string
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: `${env.ACCESS_TOKEN_TTL_MINUTES}m` })
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.JWT_SECRET) as AccessTokenPayload
}
