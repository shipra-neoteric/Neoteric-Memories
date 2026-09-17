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

// The CSRF cookie is set by the API's own origin (Render), which is a different
// origin from this app (Vercel) in production — document.cookie can only ever read
// cookies belonging to THIS page's origin, never the API's, even though the browser
// still attaches the cookie automatically to credentialed requests. So the token
// value must come from the response body instead (every endpoint that sets/rotates
// it — /login, /refresh, /me — echoes it back in the JSON), not from reading the
// cookie. Kept in memory only, reset on a full page reload just like the admin
// session itself.
let inMemoryCsrfToken: string | undefined

export function setCsrfToken(token: string | undefined): void {
  inMemoryCsrfToken = token
}

// Guest session auth used to be a cookie, but the guest app (Vercel) and API
// (Render) are on different domains, and Safari ITP / in-app browsers (WhatsApp,
// Instagram) silently drop that cross-site cookie on some devices, breaking gallery
// access. It's now a signed token (see api/src/lib/guestToken.ts) handed back once
// by GET /guest/events/:token and echoed here on every later guest request instead.
let inMemoryGuestToken: string | undefined

export function setGuestToken(token: string | undefined): void {
  inMemoryGuestToken = token
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
  if (inMemoryGuestToken) headers['X-Guest-Token'] = inMemoryGuestToken

  let body: BodyInit | undefined
  if (options.body instanceof FormData) {
    body = options.body
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(options.body)
  }

  if (method !== 'GET') {
    // Same-origin dev (Vite's proxy) can still read the cookie directly; cross-origin
    // production relies on the in-memory value set from a prior response body.
    const csrf = inMemoryCsrfToken ?? readCookie('nm_csrf')
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
