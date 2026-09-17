import rateLimit from 'express-rate-limit'
import { DEFAULTS } from '@neoteric-memories/shared'
import { env } from '../env.js'

/** IP-based guardrail for the whole public guest surface (landing, consent, selfie, results). Business-rule limits (max selfie attempts, max searches per device/event) are enforced separately in the guest domain service against GuestSession counters, since those need to survive across IPs on flaky mobile networks. */
export const guestIpLimiter = rateLimit({
  windowMs: DEFAULTS.RATE_LIMIT_GUEST_WINDOW_MINUTES * 60 * 1000,
  limit: env.NODE_ENV === 'test' ? 100000 : DEFAULTS.RATE_LIMIT_GUEST_MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many requests from this device. Please wait a few minutes and try again.' } },
})

export const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.NODE_ENV === 'test' ? 1000 : 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many login attempts. Please wait before trying again.' } },
})

export const adminApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  // Covers every /api/admin/* call for the signed-in admin's IP, including the
  // event page's own parallel photo-job draining (DRAIN_CONCURRENCY lanes in
  // EventDetailPage.tsx) alongside its background polling — bumped from 120 so a
  // single large batch doesn't exhaust the budget for the rest of the admin UI.
  limit: env.NODE_ENV === 'test' ? 10000 : 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many admin requests. Please wait a moment and try again.' } },
})
