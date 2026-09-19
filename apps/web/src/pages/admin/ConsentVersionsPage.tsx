import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ShieldCheck, Plus } from 'lucide-react'
import { CONSENT_KEYS } from '@neoteric-memories/shared'
import { apiFetch, ApiError } from '../../lib/api'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Drawer } from '../../components/ui/Drawer'
import { Input, Label, Textarea, FieldError } from '../../components/ui/Input'
import { EmptyState, PageSpinner } from '../../components/ui/EmptyState'
import { toastSuccess } from '../../lib/toast'

interface ConsentVersion {
  id: string
  label: string
  isActive: boolean
  createdAt: string
  requiredText: Record<string, string>
  optionalText: Record<string, string>
}

export function ConsentVersionsPage() {
  const queryClient = useQueryClient()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [viewing, setViewing] = useState<ConsentVersion | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [label, setLabel] = useState('')
  const [searchPurposeOn, setSearchPurposeOn] = useState(true)
  const [searchPurpose, setSearchPurpose] = useState('I understand my selfie will be used to search this event\'s photographs.')
  const [accuracyOn, setAccuracyOn] = useState(true)
  const [accuracy, setAccuracy] = useState('I understand face matching may produce incomplete or inaccurate results.')
  const [retentionOn, setRetentionOn] = useState(true)
  const [retention, setRetention] = useState('I agree to the stated temporary processing and retention policy.')
  const [contactOn, setContactOn] = useState(true)
  const [contact, setContact] = useState('I agree that Neoteric may contact me about this event.')
  const [marketingUseOn, setMarketingUseOn] = useState(true)
  const [marketingUse, setMarketingUse] = useState('I agree that selected photographs may be considered for marketing use.')

  const noRequiredSelected = !searchPurposeOn && !accuracyOn && !retentionOn

  const { data, isLoading } = useQuery({ queryKey: ['consent-versions'], queryFn: () => apiFetch<{ consentVersions: ConsentVersion[] }>('/api/admin/consent-versions') })

  const create = useMutation({
    mutationFn: () =>
      apiFetch('/api/admin/consent-versions', {
        method: 'POST',
        body: {
          label,
          // A key is only included when its toggle is on — an omitted key is how the
          // backend knows that item doesn't apply to this consent version at all
          // (not required, and never shown to the guest). See
          // consentVersionCreateSchema's own doc comment.
          requiredText: {
            ...(searchPurposeOn ? { [CONSENT_KEYS.REQUIRED_SEARCH]: searchPurpose } : {}),
            ...(accuracyOn ? { [CONSENT_KEYS.REQUIRED_ACCURACY]: accuracy } : {}),
            ...(retentionOn ? { [CONSENT_KEYS.REQUIRED_RETENTION]: retention } : {}),
          },
          optionalText: {
            ...(contactOn ? { [CONSENT_KEYS.OPTIONAL_CONTACT]: contact } : {}),
            ...(marketingUseOn ? { [CONSENT_KEYS.OPTIONAL_MARKETING_USE]: marketingUse } : {}),
          },
        },
      }),
    onSuccess: () => {
      toastSuccess('Consent version created')
      queryClient.invalidateQueries({ queryKey: ['consent-versions'] })
      setDrawerOpen(false)
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to create'),
  })

  const deactivate = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/admin/consent-versions/${id}/deactivate`, { method: 'PATCH' }),
    onSuccess: () => {
      toastSuccess('Consent version deactivated')
      queryClient.invalidateQueries({ queryKey: ['consent-versions'] })
      setViewing(null)
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to deactivate'),
  })

  const update = useMutation({
    mutationFn: (body: { label: string; requiredText: Record<string, string>; optionalText: Record<string, string> }) =>
      apiFetch(`/api/admin/consent-versions/${viewing!.id}`, { method: 'PATCH', body }),
    onSuccess: () => {
      toastSuccess('Consent version updated')
      queryClient.invalidateQueries({ queryKey: ['consent-versions'] })
      setViewing(null)
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to update'),
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Consent Versions</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Wording shown to guests before they submit a selfie. <strong>Draft only</strong> — final legal language requires review by Neoteric's authorised legal/privacy team.
          </p>
        </div>
        <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={() => setDrawerOpen(true)}>
          New version
        </Button>
      </div>

      {isLoading ? (
        <PageSpinner />
      ) : !data?.consentVersions.length ? (
        <Card>
          <EmptyState icon={ShieldCheck} title="No consent versions yet" />
        </Card>
      ) : (
        <div className="space-y-3">
          {data.consentVersions.map((c) => (
            <Card
              key={c.id}
              className="p-4 flex items-center justify-between cursor-pointer hover:border-orange-300 dark:hover:border-orange-700 transition-colors"
              onClick={() => setViewing(c)}
            >
              <div>
                <p className="font-medium text-gray-900 dark:text-white">{c.label}</p>
                <p className="text-xs text-gray-400">Created {new Date(c.createdAt).toLocaleDateString()}</p>
              </div>
              <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${c.isActive ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-gray-200 text-gray-600'}`}>
                {c.isActive ? 'Active' : 'Inactive'}
              </span>
            </Card>
          ))}
        </div>
      )}

      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title="New consent version" width="lg" icon={<ShieldCheck className="w-5 h-5 text-white" />}>
        <div className="space-y-4">
          {error && <FieldError>{error}</FieldError>}
          <div>
            <Label required>Label</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Guest Face Search Consent v2" />
          </div>
          <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Required consent — untick to leave an item out of this version entirely</p>
          <div>
            <label className="flex items-center gap-2 mb-1">
              <input type="checkbox" checked={searchPurposeOn} onChange={(e) => setSearchPurposeOn(e.target.checked)} />
              <Label>Search purpose</Label>
            </label>
            {searchPurposeOn && <Textarea rows={2} value={searchPurpose} onChange={(e) => setSearchPurpose(e.target.value)} />}
          </div>
          <div>
            <label className="flex items-center gap-2 mb-1">
              <input type="checkbox" checked={accuracyOn} onChange={(e) => setAccuracyOn(e.target.checked)} />
              <Label>Match accuracy disclaimer</Label>
            </label>
            {accuracyOn && <Textarea rows={2} value={accuracy} onChange={(e) => setAccuracy(e.target.value)} />}
          </div>
          <div>
            <label className="flex items-center gap-2 mb-1">
              <input type="checkbox" checked={retentionOn} onChange={(e) => setRetentionOn(e.target.checked)} />
              <Label>Retention policy</Label>
            </label>
            {retentionOn && <Textarea rows={2} value={retention} onChange={(e) => setRetention(e.target.value)} />}
          </div>
          {noRequiredSelected && <FieldError>Select at least one required consent item</FieldError>}

          <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Optional consent (never required for photo retrieval)</p>
          <div>
            <label className="flex items-center gap-2 mb-1">
              <input type="checkbox" checked={contactOn} onChange={(e) => setContactOn(e.target.checked)} />
              <Label>Marketing contact</Label>
            </label>
            {contactOn && <Textarea rows={2} value={contact} onChange={(e) => setContact(e.target.value)} />}
          </div>
          <div>
            <label className="flex items-center gap-2 mb-1">
              <input type="checkbox" checked={marketingUseOn} onChange={(e) => setMarketingUseOn(e.target.checked)} />
              <Label>Marketing photo use</Label>
            </label>
            {marketingUseOn && <Textarea rows={2} value={marketingUse} onChange={(e) => setMarketingUse(e.target.value)} />}
          </div>
        </div>
        <div className="pt-2 flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setDrawerOpen(false)}>
            Cancel
          </Button>
          <Button variant="primary" loading={create.isPending} onClick={() => create.mutate()} disabled={!label || noRequiredSelected}>
            Create
          </Button>
        </div>
      </Drawer>

      <Drawer open={!!viewing} onClose={() => setViewing(null)} title={viewing?.label ?? ''} width="lg" icon={<ShieldCheck className="w-5 h-5 text-white" />}>
        {viewing && (
          <EditConsentVersionForm
            key={viewing.id}
            version={viewing}
            error={error}
            saving={update.isPending}
            deactivating={deactivate.isPending}
            onSave={(body) => update.mutate(body)}
            onDeactivate={() => deactivate.mutate(viewing.id)}
            onClose={() => setViewing(null)}
          />
        )}
      </Drawer>
    </div>
  )
}

function EditConsentVersionForm({
  version,
  error,
  saving,
  deactivating,
  onSave,
  onDeactivate,
  onClose,
}: {
  version: ConsentVersion
  error: string | null
  saving: boolean
  deactivating: boolean
  onSave: (body: { label: string; requiredText: Record<string, string>; optionalText: Record<string, string> }) => void
  onDeactivate: () => void
  onClose: () => void
}) {
  const [label, setLabel] = useState(version.label)
  const [searchPurposeOn, setSearchPurposeOn] = useState(CONSENT_KEYS.REQUIRED_SEARCH in version.requiredText)
  const [searchPurpose, setSearchPurpose] = useState(version.requiredText[CONSENT_KEYS.REQUIRED_SEARCH] ?? '')
  const [accuracyOn, setAccuracyOn] = useState(CONSENT_KEYS.REQUIRED_ACCURACY in version.requiredText)
  const [accuracy, setAccuracy] = useState(version.requiredText[CONSENT_KEYS.REQUIRED_ACCURACY] ?? '')
  const [retentionOn, setRetentionOn] = useState(CONSENT_KEYS.REQUIRED_RETENTION in version.requiredText)
  const [retention, setRetention] = useState(version.requiredText[CONSENT_KEYS.REQUIRED_RETENTION] ?? '')
  const [contactOn, setContactOn] = useState(CONSENT_KEYS.OPTIONAL_CONTACT in version.optionalText)
  const [contact, setContact] = useState(version.optionalText[CONSENT_KEYS.OPTIONAL_CONTACT] ?? '')
  const [marketingUseOn, setMarketingUseOn] = useState(CONSENT_KEYS.OPTIONAL_MARKETING_USE in version.optionalText)
  const [marketingUse, setMarketingUse] = useState(version.optionalText[CONSENT_KEYS.OPTIONAL_MARKETING_USE] ?? '')

  const noRequiredSelected = !searchPurposeOn && !accuracyOn && !retentionOn

  return (
    <>
      <div className="space-y-4">
        {error && <FieldError>{error}</FieldError>}
        <p className="text-xs text-gray-400">
          Created {new Date(version.createdAt).toLocaleDateString()} —{' '}
          <span className={version.isActive ? 'text-green-600' : 'text-gray-500'}>{version.isActive ? 'Active' : 'Inactive'}</span>
        </p>
        <div>
          <Label required>Label</Label>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>

        <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Required consent — untick to leave an item out</p>
        <div>
          <label className="flex items-center gap-2 mb-1">
            <input type="checkbox" checked={searchPurposeOn} onChange={(e) => setSearchPurposeOn(e.target.checked)} />
            <Label>Search purpose</Label>
          </label>
          {searchPurposeOn && <Textarea rows={2} value={searchPurpose} onChange={(e) => setSearchPurpose(e.target.value)} />}
        </div>
        <div>
          <label className="flex items-center gap-2 mb-1">
            <input type="checkbox" checked={accuracyOn} onChange={(e) => setAccuracyOn(e.target.checked)} />
            <Label>Match accuracy disclaimer</Label>
          </label>
          {accuracyOn && <Textarea rows={2} value={accuracy} onChange={(e) => setAccuracy(e.target.value)} />}
        </div>
        <div>
          <label className="flex items-center gap-2 mb-1">
            <input type="checkbox" checked={retentionOn} onChange={(e) => setRetentionOn(e.target.checked)} />
            <Label>Retention policy</Label>
          </label>
          {retentionOn && <Textarea rows={2} value={retention} onChange={(e) => setRetention(e.target.value)} />}
        </div>
        {noRequiredSelected && <FieldError>Select at least one required consent item</FieldError>}

        <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Optional consent (never required for photo retrieval)</p>
        <div>
          <label className="flex items-center gap-2 mb-1">
            <input type="checkbox" checked={contactOn} onChange={(e) => setContactOn(e.target.checked)} />
            <Label>Marketing contact</Label>
          </label>
          {contactOn && <Textarea rows={2} value={contact} onChange={(e) => setContact(e.target.value)} />}
        </div>
        <div>
          <label className="flex items-center gap-2 mb-1">
            <input type="checkbox" checked={marketingUseOn} onChange={(e) => setMarketingUseOn(e.target.checked)} />
            <Label>Marketing photo use</Label>
          </label>
          {marketingUseOn && <Textarea rows={2} value={marketingUse} onChange={(e) => setMarketingUse(e.target.value)} />}
        </div>
      </div>
      <div className="pt-2 flex justify-end gap-3">
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
        {version.isActive && (
          <Button variant="danger" loading={deactivating} onClick={onDeactivate}>
            Deactivate
          </Button>
        )}
        <Button
          variant="primary"
          loading={saving}
          disabled={!label || noRequiredSelected}
          onClick={() =>
            onSave({
              label,
              requiredText: {
                ...(searchPurposeOn ? { [CONSENT_KEYS.REQUIRED_SEARCH]: searchPurpose } : {}),
                ...(accuracyOn ? { [CONSENT_KEYS.REQUIRED_ACCURACY]: accuracy } : {}),
                ...(retentionOn ? { [CONSENT_KEYS.REQUIRED_RETENTION]: retention } : {}),
              },
              optionalText: {
                ...(contactOn ? { [CONSENT_KEYS.OPTIONAL_CONTACT]: contact } : {}),
                ...(marketingUseOn ? { [CONSENT_KEYS.OPTIONAL_MARKETING_USE]: marketingUse } : {}),
              },
            })
          }
        >
          Save changes
        </Button>
      </div>
    </>
  )
}
