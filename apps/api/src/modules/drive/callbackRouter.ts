import { Router } from 'express'
import { z } from 'zod'
import { asyncHandler } from '../../middleware/asyncHandler.js'
import { requireAuth } from '../../middleware/auth.js'
import { validateQuery } from '../../middleware/validate.js'
import { env } from '../../env.js'
import { logger } from '../../lib/logger.js'
import * as driveService from './service.js'

export const driveCallbackRouter = Router()

const callbackQuery = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
})

/**
 * Fixed callback URL Google redirects back to after consent — must exactly match
 * an "Authorized redirect URI" on the OAuth client in Google Cloud Console. This is
 * a top-level browser navigation (not a fetch call), so the admin's session cookie
 * is still sent (SameSite=Lax allows top-level GET navigations) and requireAuth
 * works normally here.
 */
driveCallbackRouter.get(
  '/callback',
  requireAuth,
  validateQuery(callbackQuery),
  asyncHandler(async (req, res) => {
    const { code, state, error } = req.query as unknown as z.infer<typeof callbackQuery>
    if (error || !code || !state) {
      logger.warn({ error }, 'Google Drive OAuth callback returned an error or missing params')
      return res.redirect(`${env.APP_BASE_URL}/admin/events?driveError=1`)
    }
    try {
      const { eventId } = await driveService.handleOAuthCallback(code, state, req.user!)
      res.redirect(`${env.APP_BASE_URL}/admin/events/${eventId}?driveConnected=1`)
    } catch (err) {
      logger.error({}, `Drive OAuth callback failed: ${err instanceof Error ? err.message : String(err)}`)
      res.redirect(`${env.APP_BASE_URL}/admin/events?driveError=1`)
    }
  })
)
