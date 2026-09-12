/**
 * Regression tests for the fail-closed test-environment guard system — proves that
 * under the Vitest test runtime, no code path can ever construct a real S3 client, a
 * real Rekognition client, a real Google OAuth2 client, or connect to a real MongoDB,
 * EVEN WHEN process.env contains real-looking production credentials (simulating a
 * developer's real .env being present, which is exactly what caused the original
 * production-data-pollution incident this guard system exists to prevent).
 *
 * @aws-sdk/client-s3, @aws-sdk/client-rekognition, googleapis, and mongodb-memory-server
 * are all mocked with spies below so every assertion here is backed by a call-count
 * check, not just "no error was thrown" — see the "zero real external calls" describe
 * block at the bottom for the consolidated evidence.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@aws-sdk/client-s3', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, S3Client: vi.fn() }
})

vi.mock('@aws-sdk/client-rekognition', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return { ...actual, RekognitionClient: vi.fn() }
})

vi.mock('googleapis', async (importOriginal) => {
  const actual = await importOriginal<{ google: Record<string, unknown> }>()
  const authActual = actual.google.auth as Record<string, unknown>
  return {
    ...actual,
    google: {
      ...actual.google,
      auth: { ...authActual, OAuth2: vi.fn() },
      drive: vi.fn(),
      oauth2: vi.fn(),
    },
  }
})

// Fully fakes the ephemeral-Mongo-and-Prisma bootstrap for this file only, so the
// "ignores a real DATABASE_URL" test below never spawns a real process, and so this
// file's own test/setup.ts beforeAll/afterAll (which run per test file) are instant.
vi.mock('mongodb-memory-server', () => {
  const create = vi.fn(async () => ({
    getUri: (dbName: string) => `mongodb://127.0.0.1:0/${dbName}`,
    waitUntilRunning: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
  }))
  return { MongoMemoryReplSet: { create } }
})

vi.mock('../../prisma/generated/client/index.js', () => {
  class FakePrismaClient {
    async $connect() {}
    async $disconnect() {}
  }
  return { PrismaClient: FakePrismaClient }
})

import { RekognitionClient } from '@aws-sdk/client-rekognition'
import { S3Client } from '@aws-sdk/client-s3'
import { google } from 'googleapis'
import { MongoMemoryReplSet } from 'mongodb-memory-server'

const s3ClientSpy = S3Client as unknown as ReturnType<typeof vi.fn>
const rekognitionClientSpy = RekognitionClient as unknown as ReturnType<typeof vi.fn>
const oauth2ClientSpy = google.auth.OAuth2 as unknown as ReturnType<typeof vi.fn>
const mongoMemoryReplSetCreateSpy = MongoMemoryReplSet.create as unknown as ReturnType<typeof vi.fn>

const ORIGINAL_ENV = { ...process.env }

/** Sets env vars that look exactly like a real, fully-configured production .env. */
function setRealLookingCredentials() {
  process.env.DATABASE_URL = 'mongodb+srv://realuser:realpass@real-production-cluster.mongodb.net/neoteric_memories'
  process.env.STORAGE_PROVIDER = 's3'
  process.env.S3_BUCKET = 'neoteric-memories-event-photos'
  process.env.S3_REGION = 'ap-south-1'
  process.env.S3_ACCESS_KEY_ID = 'AKIAREALLOOKINGKEYID'
  process.env.S3_SECRET_ACCESS_KEY = 'realLookingSecretAccessKeyValue1234567890'
  process.env.FACE_PROVIDER = 'rekognition'
  process.env.AWS_REGION = 'ap-south-1'
  process.env.AWS_ACCESS_KEY_ID = 'AKIAREALLOOKINGKEYID'
  process.env.AWS_SECRET_ACCESS_KEY = 'realLookingSecretAccessKeyValue1234567890'
  process.env.LIVENESS_PROVIDER = 'aws'
  // Deliberately NOT shaped like a real Google client id/secret (no
  // "<digits>-<id>.apps.googleusercontent.com" / "GOCSPX-" prefix) — GitHub's push
  // protection pattern-matches on exactly that shape, and this test only needs a
  // non-empty "looks configured" value, not a realistic-looking one.
  process.env.GOOGLE_CLIENT_ID = 'test-fixture-not-a-real-google-client-id'
  process.env.GOOGLE_CLIENT_SECRET = 'test-fixture-not-a-real-google-client-secret'
  process.env.GOOGLE_OAUTH_REDIRECT_URI = 'https://api.neotericmemories.example.com/api/admin/integrations/google/callback'
}

// Deliberately no beforeEach(vi.clearAllMocks()) here — the "zero real external
// calls" describe block at the bottom depends on the S3Client/RekognitionClient/
// OAuth2 constructor spies accumulating call counts across every test in this file,
// so it can prove zero calls happened over the *entire* run, not just the last test.

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  vi.resetModules()
})

describe('isTestRuntime()', () => {
  it('is true under the real Vitest runtime', async () => {
    const { isTestRuntime } = await import('../../src/lib/testGuard.js')
    expect(isTestRuntime()).toBe(true)
  })
})

describe('env.ts forcing — real-looking credentials present', () => {
  it('forces every external-provider-selecting var to its mock/local/disabled value, ignoring real-looking overrides', async () => {
    setRealLookingCredentials()
    vi.resetModules()
    const { env } = await import('../../src/env.js')

    expect(env.NODE_ENV).toBe('test')
    expect(env.DATABASE_URL).toBe('')
    expect(env.STORAGE_PROVIDER).toBe('local')
    expect(env.FACE_PROVIDER).toBe('mock')
    expect(env.LIVENESS_PROVIDER).toBe('mock')
    expect(env.GOOGLE_CLIENT_ID).toBe('')
    expect(env.GOOGLE_CLIENT_SECRET).toBe('')
    expect(env.GOOGLE_OAUTH_REDIRECT_URI).toBeUndefined()
  })

  it('does NOT clear the underlying AWS/S3 credential values themselves — forcing the provider selection is what stops real calls, not credential absence', async () => {
    setRealLookingCredentials()
    vi.resetModules()
    const { env } = await import('../../src/env.js')

    expect(env.AWS_ACCESS_KEY_ID).toBe('AKIAREALLOOKINGKEYID')
    expect(env.S3_BUCKET).toBe('neoteric-memories-event-photos')
  })
})

describe('storage provider — test mode + STORAGE_PROVIDER=s3', () => {
  it('getStorageProvider() returns LocalStorageProvider, never S3StorageProvider', async () => {
    setRealLookingCredentials()
    vi.resetModules()
    const { getStorageProvider } = await import('../../src/providers/storage/index.js')
    const { LocalStorageProvider } = await import('../../src/providers/storage/LocalStorageProvider.js')
    const { S3StorageProvider } = await import('../../src/providers/storage/S3StorageProvider.js')

    const provider = getStorageProvider()
    expect(provider).toBeInstanceOf(LocalStorageProvider)
    expect(provider).not.toBeInstanceOf(S3StorageProvider)
  })

  it('constructing S3StorageProvider directly throws under the test runtime, even with valid-looking S3 config', async () => {
    setRealLookingCredentials()
    vi.resetModules()
    const { S3StorageProvider } = await import('../../src/providers/storage/S3StorageProvider.js')
    expect(() => new S3StorageProvider()).toThrow(/test runtime/)
  })
})

describe('face search provider — test mode + FACE_PROVIDER=rekognition', () => {
  it('getFaceSearchProvider() returns MockFaceSearchProvider, never RekognitionFaceSearchProvider', async () => {
    setRealLookingCredentials()
    vi.resetModules()
    const { getFaceSearchProvider } = await import('../../src/providers/faceSearch/index.js')
    const { MockFaceSearchProvider } = await import('../../src/providers/faceSearch/MockFaceSearchProvider.js')
    const { RekognitionFaceSearchProvider } = await import('../../src/providers/faceSearch/RekognitionFaceSearchProvider.js')

    const provider = getFaceSearchProvider()
    expect(provider).toBeInstanceOf(MockFaceSearchProvider)
    expect(provider).not.toBeInstanceOf(RekognitionFaceSearchProvider)
  })

  it('constructing RekognitionFaceSearchProvider directly throws under the test runtime, even with valid-looking AWS config', async () => {
    setRealLookingCredentials()
    vi.resetModules()
    const { RekognitionFaceSearchProvider } = await import('../../src/providers/faceSearch/RekognitionFaceSearchProvider.js')
    expect(() => new RekognitionFaceSearchProvider()).toThrow(/test runtime/)
  })
})

describe('liveness provider — test mode + LIVENESS_PROVIDER=aws', () => {
  it('getLivenessProvider() returns MockLivenessProvider, never UnconfiguredAwsLivenessProvider', async () => {
    setRealLookingCredentials()
    vi.resetModules()
    const { getLivenessProvider } = await import('../../src/providers/liveness/index.js')
    const { MockLivenessProvider, UnconfiguredAwsLivenessProvider } = await import('../../src/providers/liveness/LivenessProvider.js')

    const provider = getLivenessProvider()
    expect(provider).toBeInstanceOf(MockLivenessProvider)
    expect(provider).not.toBeInstanceOf(UnconfiguredAwsLivenessProvider)
  })

  it('constructing UnconfiguredAwsLivenessProvider directly throws under the test runtime', async () => {
    setRealLookingCredentials()
    vi.resetModules()
    const { UnconfiguredAwsLivenessProvider } = await import('../../src/providers/liveness/LivenessProvider.js')
    expect(() => new UnconfiguredAwsLivenessProvider()).toThrow(/test runtime/)
  })
})

describe('Google Drive — test mode + real-looking GOOGLE_CLIENT_ID/SECRET', () => {
  it('isDriveIntegrationConfigured() reports false regardless of real-looking credentials', async () => {
    setRealLookingCredentials()
    vi.resetModules()
    const { isDriveIntegrationConfigured } = await import('../../src/providers/drive/googleDriveClient.js')
    expect(isDriveIntegrationConfigured()).toBe(false)
  })

  it('buildGoogleConsentUrl() throws under the test runtime and never constructs a real OAuth2 client', async () => {
    setRealLookingCredentials()
    vi.resetModules()
    const { buildGoogleConsentUrl } = await import('../../src/providers/drive/googleDriveClient.js')
    expect(() => buildGoogleConsentUrl('some-state')).toThrow(/test runtime/)
  })

  it('exchangeCodeForRefreshToken() and driveClientForRefreshTokenEnc() both throw under the test runtime', async () => {
    setRealLookingCredentials()
    vi.resetModules()
    const { exchangeCodeForRefreshToken, driveClientForRefreshTokenEnc } = await import('../../src/providers/drive/googleDriveClient.js')
    await expect(exchangeCodeForRefreshToken('some-code')).rejects.toThrow(/test runtime/)
    expect(() => driveClientForRefreshTokenEnc('deadbeef.deadbeef.deadbeef')).toThrow(/test runtime/)
  })

  it('runDriveSyncSweep() no-ops instantly instead of syncing any real integration', async () => {
    setRealLookingCredentials()
    vi.resetModules()
    const { runDriveSyncSweep } = await import('../../src/modules/drive/service.js')
    const result = await runDriveSyncSweep()
    expect(result).toEqual({ integrationsSynced: 0, photosImported: 0 })
  })
})

describe('database — test mode + real-looking DATABASE_URL', () => {
  it('ignores the real-looking DATABASE_URL entirely and boots only the mocked MongoMemoryReplSet', async () => {
    setRealLookingCredentials()
    vi.resetModules()
    const { connectDatabase, disconnectDatabase } = await import('../../src/db.js')

    await connectDatabase()
    expect(mongoMemoryReplSetCreateSpy).toHaveBeenCalled()
    expect(process.env.DATABASE_URL).not.toContain('real-production-cluster.mongodb.net')
    expect(process.env.DATABASE_URL).toContain('127.0.0.1')
    await disconnectDatabase()
  })
})

describe('zero real external calls — consolidated evidence', () => {
  it('after exercising every guarded path above with real-looking credentials, the real AWS and Google SDK client constructors were never called', () => {
    // Each describe block above already ran its own guarded path with real-looking
    // credentials present; vi.clearAllMocks() only runs in beforeEach (before each
    // test), not between describe blocks, so by the time this final test runs in the
    // same file, every prior call attempt has already been recorded here.
    expect(s3ClientSpy).not.toHaveBeenCalled()
    expect(rekognitionClientSpy).not.toHaveBeenCalled()
    expect(oauth2ClientSpy).not.toHaveBeenCalled()
  })
})
