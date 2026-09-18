import type { ErrorRequestHandler } from 'express'
import { ZodError } from 'zod'
import { HttpError } from '../lib/errors.js'
import { logger } from '../lib/logger.js'

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: err.flatten() } })
    return
  }
  if (err instanceof HttpError) {
    if (err.status >= 500) {
      logger.error({ path: req.path, status: err.status }, err.message)
    }
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } })
    return
  }
  // Never collapse an unexpected exception into just its message — an AWS SDK error
  // (S3/Rekognition) carries a name, its own error code, and a request id that are
  // essential for diagnosing which call failed and why, and none of it is sensitive
  // (unlike the request body, which may contain a selfie/photo — never logged here).
  const meta = err && typeof err === 'object' ? (err as Record<string, unknown>).$metadata : undefined
  const errName = err instanceof Error ? err.name : undefined
  const awsErrorCode = err && typeof err === 'object' ? (err as Record<string, unknown>).Code ?? (err as Record<string, unknown>).code : undefined
  const awsRequestId = meta && typeof meta === 'object' ? (meta as Record<string, unknown>).requestId : undefined
  const awsHttpStatusCode = meta && typeof meta === 'object' ? (meta as Record<string, unknown>).httpStatusCode : undefined
  logger.error({ path: req.path, errName, errMessage: err instanceof Error ? err.message : String(err), awsErrorCode, awsRequestId, awsHttpStatusCode }, 'Unhandled error')

  // Only ever echoes AWS SDK-shaped errors (identified by the $metadata every AWS
  // SDK v3 error carries) back to the browser — those fields are standardized,
  // request-scoped diagnostics (error name/code/request id), never credentials or
  // secrets, unlike an arbitrary JS error's message/stack which might mention a file
  // path or similar and stays server-log-only. Temporary: pulling this from Vercel's
  // own function logs was proving hard to get to reliably, so this is here to
  // unblock diagnosing the current photos/finalize 500 without that — safe to leave
  // in (it only ever fires for a genuinely unexpected exception, which shouldn't be
  // happening in steady state), but the awsDebug field can be dropped once resolved.
  // errName alone (e.g. "TypeError", "MongoServerError") is safe regardless of
  // source — it's just the JS error class. The AWS-specific fields only get added
  // when $metadata confirms this really is an AWS SDK error, since a non-AWS
  // error's message/stack could otherwise mention a file path or similar and stays
  // server-log-only.
  const awsDebug = { errName, ...(meta && typeof meta === 'object' ? { awsErrorCode, awsRequestId, awsHttpStatusCode } : {}) }
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.', awsDebug } })
}
