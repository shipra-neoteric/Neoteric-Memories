import { Router } from 'express'
import { loginSchema } from '@neoteric-memories/shared'
import { asyncHandler } from '../../middleware/asyncHandler.js'
import { validateBody } from '../../middleware/validate.js'
import { requireAuth } from '../../middleware/auth.js'
import { adminLoginLimiter } from '../../middleware/rateLimit.js'
import { clientIpHash } from '../../lib/request.js'
import { clearAuthCookies, COOKIE_NAMES, setAccessCookie, setCsrfCookie, setRefreshCookie } from '../../lib/cookies.js'
import * as authService from './service.js'

export const authRouter = Router()

authRouter.post(
  '/login',
  adminLoginLimiter,
  validateBody(loginSchema),
  asyncHandler(async (req, res) => {
    const result = await authService.login(req.body.email, req.body.password, {
      ipHash: clientIpHash(req),
      userAgent: req.header('user-agent'),
    })
    setAccessCookie(res, result.accessToken)
    setRefreshCookie(res, result.refreshToken)
    setCsrfCookie(res, result.csrfToken)
    res.json({ user: result.user, csrfToken: result.csrfToken })
  })
)

authRouter.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const rawRefresh = req.cookies?.[COOKIE_NAMES.REFRESH]
    if (!rawRefresh) return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'No session' } })
    const result = await authService.refresh(rawRefresh, { ipHash: clientIpHash(req), userAgent: req.header('user-agent') })
    setAccessCookie(res, result.accessToken)
    setRefreshCookie(res, result.refreshToken)
    setCsrfCookie(res, result.csrfToken)
    res.json({ user: result.user, csrfToken: result.csrfToken })
  })
)

authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    await authService.logout(req.cookies?.[COOKIE_NAMES.REFRESH])
    clearAuthCookies(res)
    res.json({ success: true })
  })
)

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    // The CSRF cookie itself is cross-origin-unreadable by frontend JS (Vercel/Render
    // are different origins), even though the browser still sends it automatically —
    // so echo its current value back in the body too, exactly like /login and
    // /refresh do, letting a page reload (which only calls /me, not /login) recover a
    // usable token for subsequent state-changing requests.
    res.json({ user: req.user, csrfToken: req.cookies?.[COOKIE_NAMES.CSRF] })
  })
)
