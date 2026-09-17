import { useEffect, useState } from 'react'
import { Outlet, useParams } from 'react-router-dom'
import { apiFetch, setGuestToken } from '../lib/api'
import { GuestShell } from './GuestShell'
import { GuestFlowContext, type GuestConsentVersion, type GuestEventInfo } from './GuestFlowContext'

interface LandingResponse {
  ok: boolean
  reason?: string
  sessionId?: string
  sessionToken?: string
  event?: GuestEventInfo
  consentVersion?: GuestConsentVersion | null
  consentAlreadyGiven?: boolean
}

// Remembers this device's own previous guest session per access-token link, so
// revisiting the same QR-code link resumes the same session instead of always
// starting fresh — the server used to infer this from a cookie, but that cookie is
// cross-site (guest app and API are on different domains) and gets dropped by
// Safari ITP / in-app browsers on some devices. localStorage is same-origin to this
// page, so it isn't subject to that at all.
function loadStoredSession(token: string): { sessionId: string; sessionToken: string } | null {
  try {
    const raw = localStorage.getItem(`nm_guest_${token}`)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function storeSession(token: string, sessionId: string, sessionToken: string): void {
  try {
    localStorage.setItem(`nm_guest_${token}`, JSON.stringify({ sessionId, sessionToken }))
  } catch {
    // Best-effort only — a device with localStorage disabled just won't get session
    // resumption across visits; auth for the current visit still works fine.
  }
}

export function GuestFlow() {
  const { token = '' } = useParams<{ token: string }>()
  const [loading, setLoading] = useState(true)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [event, setEvent] = useState<GuestEventInfo | null>(null)
  const [consentVersion, setConsentVersion] = useState<GuestConsentVersion | null>(null)
  const [consentAlreadyGiven, setConsentAlreadyGiven] = useState(false)
  const [deniedReason, setDeniedReason] = useState<string | null>(null)
  const [searchId, setSearchIdState] = useState<string | null>(() => sessionStorage.getItem(`nm_search_${token}`))

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const stored = loadStoredSession(token)
    if (stored) setGuestToken(stored.sessionToken)
    const query = stored ? `?sid=${encodeURIComponent(stored.sessionId)}` : ''
    apiFetch<LandingResponse>(`/api/guest/events/${token}${query}`)
      .then((res) => {
        if (cancelled) return
        if (!res.ok) {
          setDeniedReason(res.reason ?? 'INVALID')
          return
        }
        if (res.sessionId && res.sessionToken) {
          setGuestToken(res.sessionToken)
          storeSession(token, res.sessionId, res.sessionToken)
        }
        setSessionId(res.sessionId ?? null)
        setEvent(res.event ?? null)
        setConsentVersion(res.consentVersion ?? null)
        setConsentAlreadyGiven(!!res.consentAlreadyGiven)
      })
      .catch(() => setDeniedReason('INVALID'))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [token])

  const setSearchId = (id: string) => {
    setSearchIdState(id)
    sessionStorage.setItem(`nm_search_${token}`, id)
  }

  return (
    <GuestShell>
      <GuestFlowContext.Provider
        value={{
          token,
          sessionId,
          event,
          consentVersion,
          consentAlreadyGiven,
          deniedReason,
          loading,
          markConsentGiven: () => setConsentAlreadyGiven(true),
          searchId,
          setSearchId,
        }}
      >
        <Outlet />
      </GuestFlowContext.Provider>
    </GuestShell>
  )
}
