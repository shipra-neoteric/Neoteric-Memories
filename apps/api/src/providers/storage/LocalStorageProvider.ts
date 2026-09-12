import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { env } from '../../env.js'
import type { PutObjectInput, StorageProvider } from './StorageProvider.js'

/**
 * Dev/demo storage provider — writes to a local directory and serves reads through a
 * signed, expiring route (see src/modules/files/filesRouter.ts). Not for production
 * use across multiple app instances; swap to S3StorageProvider for that.
 */
export class LocalStorageProvider implements StorageProvider {
  private root: string

  constructor(root = env.LOCAL_STORAGE_DIR) {
    this.root = path.resolve(root)
  }

  private resolveKey(key: string): string {
    const normalized = path.normalize(key).replace(/^([./\\]+)/, '')
    const full = path.resolve(this.root, normalized)
    if (!full.startsWith(this.root)) {
      throw new Error('Path traversal detected in storage key')
    }
    return full
  }

  async putObject({ key, body }: PutObjectInput): Promise<void> {
    const full = this.resolveKey(key)
    await fs.mkdir(path.dirname(full), { recursive: true })
    await fs.writeFile(full, body)
  }

  async getObject(key: string): Promise<Buffer> {
    return fs.readFile(this.resolveKey(key))
  }

  async deleteObject(key: string): Promise<void> {
    await fs.rm(this.resolveKey(key), { force: true })
  }

  async deleteObjects(keys: string[]): Promise<void> {
    await Promise.all(keys.map((k) => this.deleteObject(k)))
  }

  async objectExists(key: string): Promise<boolean> {
    try {
      await fs.access(this.resolveKey(key))
      return true
    } catch {
      return false
    }
  }

  async getSignedDownloadUrl(key: string, ttlSeconds: number, opts?: { downloadFilename?: string }): Promise<string> {
    const exp = Date.now() + ttlSeconds * 1000
    const sig = signKey(key, exp)
    const params = new URLSearchParams({ exp: String(exp), sig })
    if (opts?.downloadFilename) params.set('dl', opts.downloadFilename)
    return `${env.API_BASE_URL}/files/${encodeURIComponent(key)}?${params.toString()}`
  }
}

export function signKey(key: string, exp: number): string {
  return crypto.createHmac('sha256', env.COOKIE_SECRET).update(`${key}:${exp}`).digest('hex')
}

export function verifySignedKey(key: string, exp: number, sig: string): boolean {
  if (Date.now() > exp) return false
  const expected = signKey(key, exp)
  const a = Buffer.from(expected)
  const b = Buffer.from(sig)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}
