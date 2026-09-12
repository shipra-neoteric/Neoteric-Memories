/**
 * Minimal structured logger. Deliberately dependency-free.
 *
 * SECURITY / PRIVACY: never pass raw selfie bytes, face embedding vectors, provider
 * face descriptors, session cookies, tokens, or passwords to these functions. Only
 * pass hashed/derived identifiers (ipHash, deviceHash, selfieHash, tokenHash, ids).
 */
type LogFields = Record<string, unknown>

const SENSITIVE_KEYS = new Set([
  'password',
  'passwordHash',
  'token',
  'accessToken',
  'refreshToken',
  'selfie',
  'selfieBuffer',
  'faceEmbedding',
  'embedding',
  'authorization',
  'cookie',
])

function redact(fields: LogFields): LogFields {
  const out: LogFields = {}
  for (const [key, value] of Object.entries(fields)) {
    out[key] = SENSITIVE_KEYS.has(key) ? '[redacted]' : value
  }
  return out
}

function emit(level: 'info' | 'warn' | 'error' | 'debug', fields: LogFields, message: string) {
  const entry = {
    level,
    time: new Date().toISOString(),
    msg: message,
    ...redact(fields),
  }
  const line = JSON.stringify(entry)
  if (level === 'error') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)
}

export const logger = {
  info: (fields: LogFields, message: string) => emit('info', fields, message),
  warn: (fields: LogFields, message: string) => emit('warn', fields, message),
  error: (fields: LogFields, message: string) => emit('error', fields, message),
  debug: (fields: LogFields, message: string) => {
    if (process.env.NODE_ENV !== 'production') emit('debug', fields, message)
  },
}
