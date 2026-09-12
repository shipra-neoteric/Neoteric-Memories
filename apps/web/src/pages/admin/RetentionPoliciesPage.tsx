import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Clock, Plus, PlayCircle } from 'lucide-react'
import { apiFetch, ApiError } from '../../lib/api'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Drawer } from '../../components/ui/Drawer'
import { Input, Label, FieldError } from '../../components/ui/Input'
import { EmptyState, PageSpinner } from '../../components/ui/EmptyState'
import { toastSuccess, toastError, confirmDialog } from '../../lib/toast'

interface RetentionPolicy {
  id: string
  label: string
  guestSessionTtlHours: number
  galleryAccessTtlHours: number
  signedUrlTtlMinutes: number
  selfieMaxRetentionHours: number
  eventFaceIndexRetentionDays: number
  isDefault: boolean
}

export function RetentionPoliciesPage() {
  const queryClient = useQueryClient()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [label, setLabel] = useState('')
  const [guestSessionTtlHours, setGuestSessionTtlHours] = useState(24)
  const [galleryAccessTtlHours, setGalleryAccessTtlHours] = useState(24)
  const [signedUrlTtlMinutes, setSignedUrlTtlMinutes] = useState(15)
  const [selfieMaxRetentionHours, setSelfieMaxRetentionHours] = useState(24)
  const [eventFaceIndexRetentionDays, setEventFaceIndexRetentionDays] = useState(45)

  const { data, isLoading } = useQuery({ queryKey: ['retention-policies'], queryFn: () => apiFetch<{ retentionPolicies: RetentionPolicy[] }>('/api/admin/retention-policies') })

  const create = useMutation({
    mutationFn: () =>
      apiFetch('/api/admin/retention-policies', {
        method: 'POST',
        body: { label, guestSessionTtlHours, galleryAccessTtlHours, signedUrlTtlMinutes, selfieMaxRetentionHours, eventFaceIndexRetentionDays, isDefault: false },
      }),
    onSuccess: () => {
      toastSuccess('Retention policy created')
      queryClient.invalidateQueries({ queryKey: ['retention-policies'] })
      setDrawerOpen(false)
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to create'),
  })

  const runNow = useMutation({
    mutationFn: () => apiFetch<{ result: Record<string, number> }>('/api/admin/retention-policies/run-now', { method: 'POST' }),
    onSuccess: (res) => toastSuccess(`Retention sweep complete: ${Object.entries(res.result).map(([k, v]) => `${k}=${v}`).join(', ')}`),
    onError: (err) => toastError(err instanceof ApiError ? err.message : 'Sweep failed'),
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Retention Policies</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Controls how long guest sessions, selfies, and face indexes are kept.</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            icon={<PlayCircle className="w-4 h-4" />}
            loading={runNow.isPending}
            onClick={async () => {
              const { isConfirmed } = await confirmDialog({ title: 'Run retention sweep now?', confirmButtonText: 'Run now' })
              if (isConfirmed) runNow.mutate()
            }}
          >
            Run sweep now
          </Button>
          <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={() => setDrawerOpen(true)}>
            New policy
          </Button>
        </div>
      </div>

      {isLoading ? (
        <PageSpinner />
      ) : !data?.retentionPolicies.length ? (
        <Card>
          <EmptyState icon={Clock} title="No retention policies configured" />
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {data.retentionPolicies.map((p) => (
            <Card key={p.id} className="p-4">
              <div className="flex items-center justify-between">
                <p className="font-medium text-gray-900 dark:text-white">{p.label}</p>
                {p.isDefault && <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">Default</span>}
              </div>
              <dl className="grid grid-cols-2 gap-2 mt-3 text-xs text-gray-500 dark:text-gray-400">
                <div>Guest session TTL: {p.guestSessionTtlHours}h</div>
                <div>Gallery access TTL: {p.galleryAccessTtlHours}h</div>
                <div>Signed URL TTL: {p.signedUrlTtlMinutes}m</div>
                <div>Selfie max retention: {p.selfieMaxRetentionHours}h</div>
                <div>Face index retention: {p.eventFaceIndexRetentionDays}d</div>
              </dl>
            </Card>
          ))}
        </div>
      )}

      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title="New retention policy" icon={<Clock className="w-5 h-5 text-white" />}>
        <div className="space-y-4">
          {error && <FieldError>{error}</FieldError>}
          <div>
            <Label required>Label</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <div>
            <Label>Guest session TTL (hours, max 72)</Label>
            <Input type="number" min={1} max={72} value={guestSessionTtlHours} onChange={(e) => setGuestSessionTtlHours(Number(e.target.value))} />
          </div>
          <div>
            <Label>Gallery access TTL (hours, max 72)</Label>
            <Input type="number" min={1} max={72} value={galleryAccessTtlHours} onChange={(e) => setGalleryAccessTtlHours(Number(e.target.value))} />
          </div>
          <div>
            <Label>Signed URL TTL (minutes, max 120)</Label>
            <Input type="number" min={1} max={120} value={signedUrlTtlMinutes} onChange={(e) => setSignedUrlTtlMinutes(Number(e.target.value))} />
          </div>
          <div>
            <Label>Selfie max retention (hours, max 24)</Label>
            <Input type="number" min={1} max={24} value={selfieMaxRetentionHours} onChange={(e) => setSelfieMaxRetentionHours(Number(e.target.value))} />
          </div>
          <div>
            <Label>Event face index retention (days)</Label>
            <Input type="number" min={1} max={365} value={eventFaceIndexRetentionDays} onChange={(e) => setEventFaceIndexRetentionDays(Number(e.target.value))} />
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
