import 'dotenv/config'
import { z } from 'zod'
import { isTestRuntime } from './lib/testGuard.js'

/**
 * Fail-closed for the whole test runtime, in one place, independent of statement
 * order in any other file. This is the actual fix for the incident where a
 * `.env`-sourced real DATABASE_URL leaked into a test run: that override lived in
 * test/setup.ts and relied on running before this module was first imported, which
 * ES module import hoisting does not guarantee. This module now self-corrects
 * every time it loads, so *when* it's imported no longer matters — under Vitest,
 * every external-provider-selecting env var is forced to its mock/local/disabled
 * value before the schema below ever sees whatever a real `.env` says, and no
 * later code can undo it (this runs once, at module-evaluation time, before
 * `envSchema.safeParse` runs).
 */
if (isTestRuntime()) {
  process.env.NODE_ENV = 'test'
  process.env.DATABASE_URL = ''
  process.env.STORAGE_PROVIDER = 'local'
  process.env.LOCAL_STORAGE_DIR = process.env.LOCAL_STORAGE_DIR || './test/.storage'
  process.env.FACE_PROVIDER = 'mock'
  process.env.LIVENESS_PROVIDER = 'mock'
  process.env.CAPTCHA_ENABLED = 'false'
  process.env.GOOGLE_CLIENT_ID = ''
  process.env.GOOGLE_CLIENT_SECRET = ''
  // Must be deleted, not set to '', because the schema validates this one as a URL
  // when present at all — an empty string fails z.string().url() where undefined
  // (via .optional()) would not.
  delete process.env.GOOGLE_OAUTH_REDIRECT_URI
  // Deliberately NOT clearing AWS_*/S3_*/GOOGLE_* credential values themselves —
  // leaving them as whatever a real .env has is exactly what the regression tests
  // in test/unit/testEnvironmentGuard.test.ts need to prove that even *with* real
  // credentials present, FACE_PROVIDER/STORAGE_PROVIDER/GOOGLE_CLIENT_ID being
  // forced above is what actually stops a real client from ever being constructed
  // — not merely the absence of credentials.
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  APP_BASE_URL: z.string().url().default('http://localhost:5173'),
  API_BASE_URL: z.string().url().default('http://localhost:4000'),

  // Leave empty to auto-boot an ephemeral in-process MongoDB (mongodb-memory-server) for
  // local dev — real deployments must set this to a MongoDB Atlas (or self-hosted) URI.
  DATABASE_URL: z.string().optional().default(''),

  JWT_SECRET: z
    .string()
    .min(32, 'JWT_SECRET must be at least 32 characters')
    .default('dev-only-insecure-secret-change-me-please-32chars'),
  COOKIE_SECRET: z.string().min(32).default('dev-only-insecure-cookie-secret-change-me-32c'),
  ACCESS_TOKEN_TTL_MINUTES: z.coerce.number().default(30),
  REFRESH_TOKEN_TTL_HOURS: z.coerce.number().default(12),

  // Storage provider
  STORAGE_PROVIDER: z.enum(['local', 's3']).default('local'),
  LOCAL_STORAGE_DIR: z.string().default('./storage'),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),

  // Face search provider
  FACE_PROVIDER: z.enum(['mock', 'rekognition']).default('mock'),
  AWS_REGION: z.string().optional(),
  AWS_ACCESS_KEY_ID: z.string().optional(),
  AWS_SECRET_ACCESS_KEY: z.string().optional(),

  // Policy defaults (overridable; see packages/shared/src/constants.ts for the code defaults these fall back to)
  HIGH_CONFIDENCE_THRESHOLD: z.coerce.number().min(50).max(100).optional(),
  GUEST_SESSION_TTL_HOURS: z.coerce.number().optional(),
  SIGNED_URL_TTL_MINUTES: z.coerce.number().optional(),
  SELFIE_MAX_RETENTION_HOURS: z.coerce.number().optional(),
  MAX_SELFIE_ATTEMPTS_PER_SESSION: z.coerce.number().optional(),
  MAX_SEARCHES_PER_DEVICE_PER_EVENT: z.coerce.number().optional(),

  // CAPTCHA abstraction — disabled by default in L1, interface is wired but not enforced
  CAPTCHA_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === 'true')
    .default('false'),
  CAPTCHA_PROVIDER: z.enum(['none', 'recaptcha', 'turnstile']).default('none'),
  CAPTCHA_SECRET_KEY: z.string().optional(),

  // Liveness detection abstraction — mock in dev, configurable for prod
  LIVENESS_PROVIDER: z.enum(['mock', 'aws']).default('mock'),

  // Google Drive continuous folder sync (optional — event photos can also just be
  // uploaded directly). Leave unset to disable the feature entirely; the "Connect
  // Google Drive" button is hidden when these aren't configured.
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  // Must exactly match an "Authorized redirect URI" configured on the OAuth client
  // in Google Cloud Console. Defaults to the API's own callback route.
  GOOGLE_OAUTH_REDIRECT_URI: z.string().url().optional(),
  DRIVE_SYNC_INTERVAL_MINUTES: z.coerce.number().int().min(1).default(3),
})

export type Env = z.infer<typeof envSchema>

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env)
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors)
    throw new Error('Invalid environment configuration — see printed field errors above.')
  }
  if (parsed.data.NODE_ENV === 'production') {
    const insecureDefaults = [
      'dev-only-insecure-secret-change-me-please-32chars',
      'dev-only-insecure-cookie-secret-change-me-32c',
    ]
    if (insecureDefaults.includes(parsed.data.JWT_SECRET) || insecureDefaults.includes(parsed.data.COOKIE_SECRET)) {
      throw new Error('Refusing to start in production with default dev secrets. Set JWT_SECRET / COOKIE_SECRET.')
    }
    if (!parsed.data.DATABASE_URL) {
      throw new Error('DATABASE_URL is required in production (point it at your MongoDB Atlas cluster).')
    }
  }
  return parsed.data
}

export const env = loadEnv()
