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
}

export function ConsentVersionsPage() {
  const queryClient = useQueryClient()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [label, setLabel] = useState('')
  const [searchPurpose, setSearchPurpose] = useState('I understand my selfie will be used to search this event\'s photographs.')
  const [accuracy, setAccuracy] = useState('I understand face matching may produce incomplete or inaccurate results.')
  const [retention, setRetention] = useState('I agree to the stated temporary processing and retention policy.')
  const [contact, setContact] = useState('I agree that Neoteric may contact me about this event.')
  const [marketingUse, setMarketingUse] = useState('I agree that selected photographs may be considered for marketing use.')

  const { data, isLoading } = useQuery({ queryKey: ['consent-versions'], queryFn: () => apiFetch<{ consentVersions: ConsentVersion[] }>('/api/admin/consent-versions') })

  const create = useMutation({
    mutationFn: () =>
      apiFetch('/api/admin/consent-versions', {
        method: 'POST',
        body: {
          label,
          requiredText: {
            [CONSENT_KEYS.REQUIRED_SEARCH]: searchPurpose,
            [CONSENT_KEYS.REQUIRED_ACCURACY]: accuracy,
            [CONSENT_KEYS.REQUIRED_RETENTION]: retention,
          },
          optionalText: {
            [CONSENT_KEYS.OPTIONAL_CONTACT]: contact,
            [CONSENT_KEYS.OPTIONAL_MARKETING_USE]: marketingUse,
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
            <Card key={c.id} className="p-4 flex items-center justify-between">
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
          <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Required consent</p>
          <div>
            <Label>Search purpose</Label>
            <Textarea rows={2} value={searchPurpose} onChange={(e) => setSearchPurpose(e.target.value)} />
          </div>
          <div>
            <Label>Match accuracy disclaimer</Label>
            <Textarea rows={2} value={accuracy} onChange={(e) => setAccuracy(e.target.value)} />
          </div>
          <div>
            <Label>Retention policy</Label>
            <Textarea rows={2} value={retention} onChange={(e) => setRetention(e.target.value)} />
          </div>
          <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Optional consent (never required for photo retrieval)</p>
          <div>
            <Label>Marketing contact</Label>
            <Textarea rows={2} value={contact} onChange={(e) => setContact(e.target.value)} />
          </div>
          <div>
            <Label>Marketing photo use</Label>
            <Textarea rows={2} value={marketingUse} onChange={(e) => setMarketingUse(e.target.value)} />
          </div>
        </div>
        <div className="pt-2 flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setDrawerOpen(false)}>
            Cancel
          </Button>
          <Button variant="primary" loading={create.isPending} onClick={() => create.mutate()} disabled={!label}>
            Create
          </Button>
        </div>
      </Drawer>
    </div>
  )
}
