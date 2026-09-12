export class HttpError extends Error {
  status: number
  code: string
  details?: unknown

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

export const Errors = {
  unauthorized: (msg = 'Authentication required') => new HttpError(401, 'UNAUTHORIZED', msg),
  forbidden: (msg = 'You do not have permission to perform this action') => new HttpError(403, 'FORBIDDEN', msg),
  notFound: (msg = 'Not found') => new HttpError(404, 'NOT_FOUND', msg),
  conflict: (msg: string) => new HttpError(409, 'CONFLICT', msg),
  badRequest: (msg: string, details?: unknown) => new HttpError(400, 'BAD_REQUEST', msg, details),
  tooManyRequests: (msg = 'Too many requests, please slow down') => new HttpError(429, 'RATE_LIMITED', msg),
  gone: (msg: string) => new HttpError(410, 'GONE', msg),
}
