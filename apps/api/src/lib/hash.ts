import crypto from 'node:crypto'
import { env } from '../env.js'

/** SHA-256 hex digest of a raw access token. Raw tokens are never persisted — only this. */
export function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex')
}

/** SHA-256 hex digest of file bytes, used for duplicate-photo detection within an event. */
export function hashFile(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

/** HMAC-keyed hash so raw IPs are never stored — still lets us rate-limit/correlate abuse without keeping PII at rest. */
export function hashIp(ip: string): string {
  return crypto.createHmac('sha256', env.COOKIE_SECRET).update(ip).digest('hex')
}

export function hashDeviceFingerprint(fingerprint: string): string {
  return crypto.createHmac('sha256', env.COOKIE_SECRET).update(fingerprint).digest('hex')
}

export function hashSelfieBuffer(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

export function generateSecureToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('base64url')
}
