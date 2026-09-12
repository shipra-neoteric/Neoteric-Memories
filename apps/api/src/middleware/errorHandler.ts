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
  logger.error({ path: req.path, err: err instanceof Error ? err.message : String(err) }, 'Unhandled error')
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' } })
}
