import { useEffect, useState } from 'react'
import { Outlet, useParams } from 'react-router-dom'
import { apiFetch } from '../lib/api'
import { GuestShell } from './GuestShell'
import { GuestFlowContext, type GuestConsentVersion, type GuestEventInfo } from './GuestFlowContext'

interface LandingResponse {
  ok: boolean
  reason?: string
  sessionId?: string
  event?: GuestEventInfo
  consentVersion?: GuestConsentVersion | null
  consentAlreadyGiven?: boolean
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
    apiFetch<LandingResponse>(`/api/guest/events/${token}`)
      .then((res) => {
        if (cancelled) return
        if (!res.ok) {
          setDeniedReason(res.reason ?? 'INVALID')
          return
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
