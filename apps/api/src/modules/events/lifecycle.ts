import type { EventStatus } from '@neoteric-memories/shared'
import { Errors } from '../../lib/errors.js'

/** Explicit admin-initiated transitions. READY is computed automatically (see readiness.ts); EXPIRED is set by the retention sweep, never requested directly. */
const ALLOWED_TRANSITIONS: Record<string, EventStatus[]> = {
  READY: ['LIVE', 'CLOSED'],
  LIVE: ['PAUSED', 'CLOSED'],
  PAUSED: ['LIVE', 'CLOSED'],
  CLOSED: ['ARCHIVED'],
  EXPIRED: ['ARCHIVED', 'CLOSED'],
}

export function assertValidTransition(current: EventStatus, target: EventStatus): void {
  const allowed = ALLOWED_TRANSITIONS[current] ?? []
  if (!allowed.includes(target)) {
    throw Errors.conflict(`Cannot move event from ${current} to ${target}`)
  }
}
