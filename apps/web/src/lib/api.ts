// In dev, Vite proxies /api and /files to the API server (see vite.config.ts), so a
// relative path is enough. In production, set VITE_API_BASE_URL if the web app is
// NOT served from the same origin/reverse proxy as the API.
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? ''

export class ApiError extends Error {
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

function readCookie(name: string): string | undefined {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : undefined
}

function deviceId(): string {
  const key = 'nm_device_id'
  let id = localStorage.getItem(key)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(key, id)
  }
  return id
}

export async function apiFetch<T = unknown>(
  path: string,
  options: { method?: string; body?: unknown; headers?: Record<string, string> } = {}
): Promise<T> {
  const method = options.method ?? 'GET'
  const headers: Record<string, string> = { 'X-Device-Id': deviceId(), ...options.headers }

  let body: BodyInit | undefined
  if (options.body instanceof FormData) {
    body = options.body
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(options.body)
  }

  if (method !== 'GET') {
    const csrf = readCookie('nm_csrf')
    if (csrf) headers['X-CSRF-Token'] = csrf
  }

  const res = await fetch(`${API_BASE}${path}`, { method, headers, body, credentials: 'include' })
  const isJson = res.headers.get('content-type')?.includes('application/json')
  const payload = isJson ? await res.json().catch(() => undefined) : undefined

  if (!res.ok) {
    const err = payload?.error
    throw new ApiError(res.status, err?.code ?? 'UNKNOWN', err?.message ?? `Request failed with status ${res.status}`, err?.details)
  }
  return payload as T
}
