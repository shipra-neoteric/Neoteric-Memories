import crypto from 'node:crypto'
import { env } from '../env.js'

// Key is derived from COOKIE_SECRET rather than a separate env var — one less
// secret to provision/rotate for a single-purpose "encrypt OAuth refresh tokens at
// rest" use case. Never reused for anything that needs its own key domain.
const KEY = crypto.createHash('sha256').update(`${env.COOKIE_SECRET}:drive-token-key`).digest()

/** AES-256-GCM encrypt, returned as `iv:authTag:ciphertext` (all base64url). */
export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return [iv, authTag, ciphertext].map((b) => b.toString('base64url')).join(':')
}

export function decryptSecret(encoded: string): string {
  const [ivB64, tagB64, dataB64] = encoded.split(':')
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('Malformed encrypted secret')
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(ivB64, 'base64url'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64url')), decipher.final()]).toString('utf8')
}
