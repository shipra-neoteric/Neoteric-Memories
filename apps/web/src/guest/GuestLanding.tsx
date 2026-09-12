import { useNavigate } from 'react-router-dom'
import { Camera, Clock, Lock, QrCode, ShieldAlert, Timer } from 'lucide-react'
import { useGuestFlow } from './GuestFlowContext'
import { Button } from '../components/ui/Button'
import { PageSpinner } from '../components/ui/EmptyState'

const DENIAL_COPY: Record<string, { icon: typeof QrCode; title: string; body: string }> = {
  INVALID: { icon: QrCode, title: 'This link looks incorrect', body: 'Please rescan the QR code at the event, or ask event staff for a fresh link.' },
  REVOKED: { icon: Lock, title: 'This link has been disabled', body: 'The organizer has turned off guest access for this event. Please check with event staff.' },
  EXPIRED: { icon: Clock, title: 'This link has expired', body: 'Guest access for this event is no longer available. Ask event staff for a new link if photos are still being processed.' },
  NOT_OPEN_YET: { icon: Timer, title: 'Not open yet', body: 'Guest photo search for this event has not started yet. Please check back later.' },
  PAUSED: { icon: ShieldAlert, title: 'Temporarily paused', body: 'The organizer has paused guest access for a moment. Please try again shortly.' },
  CLOSED: { icon: Lock, title: 'This event is closed', body: 'Guest photo search is no longer available for this event.' },
  NOT_READY: { icon: Timer, title: 'Photos are still being prepared', body: 'This event is not open for guest search yet. Please check back soon.' },
}

export function GuestLanding() {
  const { loading, deniedReason, event, sessionId } = useGuestFlow()
  const navigate = useNavigate()

  if (loading) return <PageSpinner />

  if (deniedReason || !event) {
    const copy = DENIAL_COPY[deniedReason ?? 'INVALID'] ?? DENIAL_COPY.INVALID
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center gap-3">
        <div className="w-14 h-14 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
          <copy.icon className="w-7 h-7 text-gray-400" />
        </div>
        <h1 className="text-lg font-bold text-gray-900 dark:text-white">{copy.title}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 max-w-xs">{copy.body}</p>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col">
      {event.coverUrl && <img src={event.coverUrl} alt={event.name} className="w-full h-40 object-cover rounded-xl mb-4" />}
      <h1 className="text-xl font-bold text-gray-900 dark:text-white">{event.name}</h1>
      <p className="text-sm text-gray-500 dark:text-gray-400">{event.siteName ? `${event.siteName} · ` : ''}{event.venue}</p>
      <p className="text-xs text-gray-400 mt-1">{new Date(event.startAt).toLocaleDateString()}</p>

      {event.description && <p className="text-sm text-gray-600 dark:text-gray-300 mt-4">{event.description}</p>}

      <div className="mt-6 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4">
        <div className="w-9 h-9 rounded-lg theme-bg flex items-center justify-center mb-2">
          <Camera className="w-4 h-4 text-white" />
        </div>
        <h2 className="text-sm font-bold text-gray-900 dark:text-white">How it works</h2>
        <ol className="text-xs text-gray-500 dark:text-gray-400 mt-2 space-y-1 list-decimal pl-4">
          <li>Accept the consent terms</li>
          <li>Take a quick selfie</li>
          <li>We search only this event's photographs</li>
          <li>Download the photos you appear in</li>
        </ol>
      </div>

      {event.likelyIncludesChildren && (
        <div className="mt-3 bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800/40 rounded-xl p-3 text-xs text-blue-800 dark:text-blue-300">
          This event may include photos of children. If you are under 18, please ask a parent or guardian to complete this search with you.
        </div>
      )}

      <p className="text-[11px] text-gray-400 mt-4">
        Guest access to this event's photos closes on {new Date(event.guestAccessExpiresAt).toLocaleDateString()}.
      </p>

      <div className="flex-1" />
      <Button variant="primary" className="w-full mt-6 py-3 text-base" disabled={!sessionId} onClick={() => navigate('consent')}>
        Find My Photos
      </Button>
      <p className="text-center text-[11px] text-gray-400 mt-2">Need help? Ask event staff, or use the Privacy notice link below.</p>
    </div>
  )
}
