import { getPrisma } from '../../db.js'
import { logger } from '../../lib/logger.js'
import { toJsonInput } from '../../lib/prismaJson.js'

export interface AuditLogInput {
  actorId?: string
  actorRole?: string
  action: string
  entityType: string
  entityId?: string
  siteId?: string
  eventId?: string
  metadata?: Record<string, unknown>
  ipHash?: string
}

/** Sensitive admin actions (event delete, QR disable, user create, threshold change, retention change, ...) must call this. Never pass raw selfie bytes, tokens, or passwords in `metadata`. */
export async function writeAuditLog(input: AuditLogInput): Promise<void> {
  try {
    await getPrisma().auditLog.create({ data: { ...input, metadata: input.metadata ? toJsonInput(input.metadata) : undefined } })
  } catch (err) {
    // Audit logging must never break the primary request flow, but a failure here is worth knowing about.
    logger.error({ action: input.action, entityType: input.entityType }, `Failed to write audit log: ${String(err)}`)
  }
}

export interface SecurityEventInput {
  type:
    | 'RATE_LIMITED'
    | 'INVALID_OR_EXPIRED_TOKEN'
    | 'EVENT_PAUSED_OR_CLOSED'
    | 'SELFIE_ATTEMPTS_EXCEEDED'
    | 'SEARCH_LIMIT_EXCEEDED'
    | 'MULTIPLE_FACES_IN_SELFIE'
    | 'NO_FACE_IN_SELFIE'
    | 'AUTH_FAILURE'
    | 'CROSS_SCOPE_ACCESS_DENIED'
    | 'RETENTION_JOB_FAILURE'
    | 'SELFIE_DELETE_FAILURE'
    | 'SUSPICIOUS_ACTIVITY'
  severity?: 'INFO' | 'WARN' | 'CRITICAL'
  eventId?: string
  guestSessionId?: string
  ipHash?: string
  deviceHash?: string
  detail?: Record<string, unknown>
}

export async function writeSecurityEvent(input: SecurityEventInput): Promise<void> {
  try {
    await getPrisma().securityEvent.create({
      data: { ...input, detail: input.detail ? toJsonInput(input.detail) : undefined, severity: input.severity ?? 'INFO' },
    })
  } catch (err) {
    logger.error({ type: input.type }, `Failed to write security event: ${String(err)}`)
  }
}
