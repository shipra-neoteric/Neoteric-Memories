import { createContext, useContext } from 'react'

export interface GuestEventInfo {
  id: string
  name: string
  type: string
  venue: string
  description?: string | null
  startAt: string
  endAt: string
  guestAccessExpiresAt: string
  siteName?: string
  coverUrl: string | null
  likelyIncludesChildren: boolean
  guardianAssistedFlow: boolean
  selfieUploadFallbackEnabled: boolean
}

export interface GuestConsentVersion {
  id: string
  label: string
  requiredText: Record<string, string>
  optionalText: Record<string, string>
}

export interface GuestFlowValue {
  token: string
  sessionId: string | null
  event: GuestEventInfo | null
  consentVersion: GuestConsentVersion | null
  consentAlreadyGiven: boolean
  deniedReason: string | null
  loading: boolean
  markConsentGiven: () => void
  searchId: string | null
  setSearchId: (id: string) => void
}

export const GuestFlowContext = createContext<GuestFlowValue | undefined>(undefined)

export function useGuestFlow(): GuestFlowValue {
  const ctx = useContext(GuestFlowContext)
  if (!ctx) throw new Error('useGuestFlow must be used within GuestFlow')
  return ctx
}
