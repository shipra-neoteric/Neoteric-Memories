import { env } from '../../env.js'
import { isTestRuntime } from '../../lib/testGuard.js'
import { LocalStorageProvider } from './LocalStorageProvider.js'
import { S3StorageProvider } from './S3StorageProvider.js'
import type { StorageProvider } from './StorageProvider.js'

let instance: StorageProvider | undefined

export function getStorageProvider(): StorageProvider {
  if (!instance) {
    // env.ts already forces STORAGE_PROVIDER to 'local' under the test runtime, so
    // in practice this branch is unreachable during tests — this check exists
    // purely as a second, independent layer that fails loudly instead of silently
    // constructing a real S3 client if that forcing were ever bypassed.
    if (isTestRuntime() && env.STORAGE_PROVIDER === 's3') {
      throw new Error('Refusing to select S3StorageProvider under the Vitest test runtime.')
    }
    instance = env.STORAGE_PROVIDER === 's3' ? new S3StorageProvider() : new LocalStorageProvider()
  }
  return instance
}

export type { StorageProvider } from './StorageProvider.js'
