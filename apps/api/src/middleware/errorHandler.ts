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
  logger.error(
    {
      path: req.path,
      errName: err instanceof Error ? err.name : undefined,
      errMessage: err instanceof Error ? err.message : String(err),
      awsErrorCode: err && typeof err === 'object' ? (err as Record<string, unknown>).Code ?? (err as Record<string, unknown>).code : undefined,
      awsRequestId: meta && typeof meta === 'object' ? (meta as Record<string, unknown>).requestId : undefined,
      awsHttpStatusCode: meta && typeof meta === 'object' ? (meta as Record<string, unknown>).httpStatusCode : undefined,
    },
    'Unhandled error'
  )
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' } })
}
