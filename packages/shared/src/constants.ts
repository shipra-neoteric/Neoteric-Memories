// Central, non-secret configuration constants shared between the API and the web app.
// Anything that is genuinely an operational secret or per-deployment value belongs in env vars, not here.

export const ROLES = [
  'MASTER_ADMIN',
  'MARKETING_HEAD',
  'EVENT_MANAGER',
  'PHOTOGRAPHER',
  'SUPPORT_EXECUTIVE',
] as const
export type Role = (typeof ROLES)[number]

export const EVENT_STATUSES = [
  'DRAFT',
  'UPLOADING',
  'PROCESSING',
  'READY',
  'LIVE',
  'PAUSED',
  'CLOSED',
  'EXPIRED',
  'ARCHIVED',
] as const
export type EventStatus = (typeof EVENT_STATUSES)[number]

export const EVENT_TYPES = [
  'FESTIVAL',
  'CUSTOMER_MEET',
  'POSSESSION_CEREMONY',
  'PROJECT_LAUNCH',
  'SITE_VISIT',
  'OTHER',
] as const
export type EventType = (typeof EVENT_TYPES)[number]

export const PHOTO_STATUSES = [
  'PENDING',
  'PROCESSING',
  'PROCESSED',
  'FAILED',
  'NO_FACES',
  'ARCHIVED',
  'DELETED',
] as const
export type PhotoStatus = (typeof PHOTO_STATUSES)[number]

export const BATCH_STATUSES = ['PENDING', 'PROCESSING', 'COMPLETED', 'PARTIAL_FAILURE', 'FAILED'] as const
export type BatchStatus = (typeof BATCH_STATUSES)[number]

export const FACE_SEARCH_STATUSES = ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'RATE_LIMITED'] as const
export type FaceSearchStatus = (typeof FACE_SEARCH_STATUSES)[number]

export const DOWNLOAD_JOB_STATUSES = ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'EXPIRED'] as const
export type DownloadJobStatus = (typeof DOWNLOAD_JOB_STATUSES)[number]

export const GUEST_SESSION_STATUSES = ['ACTIVE', 'EXPIRED', 'DELETED', 'BLOCKED'] as const
export type GuestSessionStatus = (typeof GUEST_SESSION_STATUSES)[number]

export const BACKGROUND_JOB_TYPES = [
  'PHOTO_PROCESS',
  'PHOTO_HEIC_CONVERT',
  'ZIP_GENERATE',
  'RETENTION_SWEEP',
  'SELFIE_DELETE',
  'EVENT_COLLECTION_DELETE',
  'DRIVE_SYNC',
] as const
export type BackgroundJobType = (typeof BACKGROUND_JOB_TYPES)[number]

export const DRIVE_INTEGRATION_STATUSES = ['PENDING_FOLDER', 'ACTIVE', 'PAUSED', 'ERROR'] as const
export type DriveIntegrationStatus = (typeof DRIVE_INTEGRATION_STATUSES)[number]

export const BACKGROUND_JOB_STATUSES = ['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED'] as const
export type BackgroundJobStatus = (typeof BACKGROUND_JOB_STATUSES)[number]

export const MATCH_CONFIDENCE_BANDS = ['HIGH', 'MEDIUM', 'LOW'] as const
export type MatchConfidenceBand = (typeof MATCH_CONFIDENCE_BANDS)[number]

/**
 * Default policy values. All are overridable per-deployment via SystemSetting /
 * per-event RetentionPolicy records — these are just sane starting points, NOT
 * calibrated production thresholds. See docs/FACE_PROVIDER.md.
 */
export const DEFAULTS = {
  /** Minimum similarity score (0-100) for a match to be shown to a guest at all. Must be re-calibrated against real Neoteric event photos before go-live. */
  HIGH_CONFIDENCE_THRESHOLD: 92,
  /** Below this, a result is not "medium to confirm" — it is simply never returned. We do not do confirm-to-disclose UX. */
  MAX_RESULTS_PER_SEARCH: 60,
  GUEST_SESSION_TTL_HOURS: 24,
  GALLERY_ACCESS_TTL_HOURS: 24,
  SIGNED_URL_TTL_MINUTES: 15,
  SELFIE_MAX_RETENTION_HOURS: 24,
  EVENT_FACE_INDEX_RETENTION_DAYS: 45,
  MAX_SELFIE_ATTEMPTS_PER_SESSION: 5,
  MAX_SEARCHES_PER_DEVICE_PER_EVENT: 8,
  RATE_LIMIT_GUEST_WINDOW_MINUTES: 15,
  // A normal guest journey alone is landing + consent + selfie + results + several
  // per-photo downloads/report-wrong-match calls -- 30 was tight enough that a
  // single active testing session (or a real guest retrying a few things) could hit
  // it. Doubled for headroom; still a real ceiling against abuse from one IP.
  RATE_LIMIT_GUEST_MAX_REQUESTS: 60,
  MAX_PHOTO_UPLOAD_MB: 25,
  MAX_BATCH_PHOTO_COUNT: 500,
  QR_TOKEN_BYTES: 32,
} as const

export const CONSENT_KEYS = {
  REQUIRED_SEARCH: 'search_purpose',
  REQUIRED_ACCURACY: 'match_accuracy_disclaimer',
  REQUIRED_RETENTION: 'retention_policy',
  OPTIONAL_CONTACT: 'marketing_contact',
  OPTIONAL_MARKETING_USE: 'marketing_photo_use',
} as const
export type ConsentKey = (typeof CONSENT_KEYS)[keyof typeof CONSENT_KEYS]

export const REQUIRED_CONSENT_KEYS: ConsentKey[] = [
  CONSENT_KEYS.REQUIRED_SEARCH,
  CONSENT_KEYS.REQUIRED_ACCURACY,
  CONSENT_KEYS.REQUIRED_RETENTION,
]
export const OPTIONAL_CONSENT_KEYS: ConsentKey[] = [CONSENT_KEYS.OPTIONAL_CONTACT, CONSENT_KEYS.OPTIONAL_MARKETING_USE]
