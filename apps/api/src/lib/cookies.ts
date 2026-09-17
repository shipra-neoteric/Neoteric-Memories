import type { Response } from 'express'
import { env } from '../env.js'

export const COOKIE_NAMES = {
  ACCESS: 'nm_session',
  REFRESH: 'nm_refresh',
  CSRF: 'nm_csrf',
} as const

const secure = env.NODE_ENV === 'production'
// The admin app (Vercel) and API (Render) are deployed on different domains in
// production, so cookies must be sent cross-site. SameSite=None requires Secure,
// which is why this is tied to the same flag — the actual CSRF defense is the
// X-CSRF-Token header check (requireCsrf), not SameSite, so relaxing this doesn't
// weaken anything. In dev (http://localhost), 'lax' is used since 'none' cookies
// are rejected by browsers over plain http.
const sameSite = secure ? 'none' : 'lax'

export function setAccessCookie(res: Response, token: string) {
  res.cookie(COOKIE_NAMES.ACCESS, token, {
    httpOnly: true,
    secure,
    sameSite,
    maxAge: env.ACCESS_TOKEN_TTL_MINUTES * 60 * 1000,
    path: '/',
  })
}

export function setRefreshCookie(res: Response, token: string) {
  res.cookie(COOKIE_NAMES.REFRESH, token, {
    httpOnly: true,
    secure,
    sameSite,
    maxAge: env.REFRESH_TOKEN_TTL_HOURS * 60 * 60 * 1000,
    path: '/api/admin/auth',
  })
}

export function setCsrfCookie(res: Response, token: string) {
  res.cookie(COOKIE_NAMES.CSRF, token, {
    httpOnly: false, // must be readable by client JS to echo back in a header (double-submit pattern)
    secure,
    sameSite,
    maxAge: env.REFRESH_TOKEN_TTL_HOURS * 60 * 60 * 1000,
    path: '/',
  })
}

export function clearAuthCookies(res: Response) {
  res.clearCookie(COOKIE_NAMES.ACCESS, { path: '/' })
  res.clearCookie(COOKIE_NAMES.REFRESH, { path: '/api/admin/auth' })
  res.clearCookie(COOKIE_NAMES.CSRF, { path: '/' })
}
