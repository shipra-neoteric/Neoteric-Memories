import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CONSENT_KEYS } from '@neoteric-memories/shared'
import { useGuestFlow } from './GuestFlowContext'
import { Button } from '../components/ui/Button'
import { apiFetch, ApiError } from '../lib/api'
import { PageSpinner } from '../components/ui/EmptyState'

export function GuestConsent() {
  const { sessionId, consentVersion, consentAlreadyGiven, markConsentGiven, event } = useGuestFlow()
  const navigate = useNavigate()

  const [requiredSearch, setRequiredSearch] = useState(false)
  const [requiredAccuracy, setRequiredAccuracy] = useState(false)
  const [requiredRetention, setRequiredRetention] = useState(false)
  const [optionalContact, setOptionalContact] = useState(false)
  const [optionalMarketing, setOptionalMarketing] = useState(false)
  const [guardianAssisted, setGuardianAssisted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!sessionId || !event) return <PageSpinner />

  if (consentAlreadyGiven) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center gap-3">
        <p className="text-sm text-gray-600 dark:text-gray-300">You've already accepted the consent terms for this event.</p>
        <Button variant="primary" onClick={() => navigate('../selfie')}>
          Continue to selfie
        </Button>
      </div>
    )
  }

  if (!consentVersion) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center gap-3">
        <p className="text-sm text-gray-500">This event has no consent terms configured yet. Please check with event staff.</p>
      </div>
    )
  }

  const allRequired = requiredSearch && requiredAccuracy && requiredRetention

  async function submit() {
    setSubmitting(true)
    setError(null)
    try {
      await apiFetch(`/api/guest/sessions/${sessionId}/consent`, {
        method: 'POST',
        body: {
          required: {
            [CONSENT_KEYS.REQUIRED_SEARCH]: true,
            [CONSENT_KEYS.REQUIRED_ACCURACY]: true,
            [CONSENT_KEYS.REQUIRED_RETENTION]: true,
          },
          optional: { [CONSENT_KEYS.OPTIONAL_CONTACT]: optionalContact, [CONSENT_KEYS.OPTIONAL_MARKETING_USE]: optionalMarketing },
          guardianAssisted,
        },
      })
      markConsentGiven()
      navigate('../selfie')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex-1 flex flex-col">
      <h1 className="text-lg font-bold text-gray-900 dark:text-white">Before we search for your photos</h1>
      <p className="text-xs text-gray-400 mt-1 mb-4">
        This is a draft consent notice — final legal wording requires review by Neoteric's authorised legal/privacy team.
      </p>

      {event.guardianAssistedFlow && (
        <div className="mb-4 bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800/40 rounded-xl p-3 text-xs text-blue-800 dark:text-blue-300">
          If you are under 18, a parent or guardian should complete this on your behalf.
          <label className="flex items-center gap-2 mt-2">
            <input type="checkbox" checked={guardianAssisted} onChange={(e) => setGuardianAssisted(e.target.checked)} />A parent/guardian is assisting with this search
          </label>
        </div>
      )}

      <div className="space-y-3">
        <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Required</p>
        <ConsentCheckbox checked={requiredSearch} onChange={setRequiredSearch} text={consentVersion.requiredText[CONSENT_KEYS.REQUIRED_SEARCH]} />
        <ConsentCheckbox checked={requiredAccuracy} onChange={setRequiredAccuracy} text={consentVersion.requiredText[CONSENT_KEYS.REQUIRED_ACCURACY]} />
        <ConsentCheckbox checked={requiredRetention} onChange={setRequiredRetention} text={consentVersion.requiredText[CONSENT_KEYS.REQUIRED_RETENTION]} />

        <p className="text-xs font-bold uppercase tracking-wide text-gray-500 pt-2">Optional — does not affect finding your photos</p>
        <ConsentCheckbox checked={optionalContact} onChange={setOptionalContact} text={consentVersion.optionalText[CONSENT_KEYS.OPTIONAL_CONTACT]} />
        <ConsentCheckbox checked={optionalMarketing} onChange={setOptionalMarketing} text={consentVersion.optionalText[CONSENT_KEYS.OPTIONAL_MARKETING_USE]} />
      </div>

      {error && <p className="text-xs text-red-500 mt-3">{error}</p>}

      <div className="flex-1" />
      <Button variant="primary" className="w-full mt-6 py-3 text-base" disabled={!allRequired} loading={submitting} onClick={submit}>
        I agree — continue to selfie
      </Button>
    </div>
  )
}

function ConsentCheckbox({ checked, onChange, text }: { checked: boolean; onChange: (v: boolean) => void; text: string }) {
  return (
    <label className="flex items-start gap-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3 cursor-pointer">
      <input type="checkbox" className="mt-0.5" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="text-sm text-gray-700 dark:text-gray-200">{text}</span>
    </label>
  )
}
