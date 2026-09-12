import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { CalendarDays, Plus } from 'lucide-react'
import { EVENT_TYPES, type EventType } from '@neoteric-memories/shared'
import { apiFetch, ApiError } from '../../lib/api'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Drawer } from '../../components/ui/Drawer'
import { Input, Label, FieldError, Textarea } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { EmptyState, PageSpinner } from '../../components/ui/EmptyState'
import { EVENT_STATUS_BADGE } from '../../lib/statusBadge'
import { toastSuccess } from '../../lib/toast'

interface EventRow {
  id: string
  name: string
  type: EventType
  status: string
  venue: string
  startAt: string
  siteId: string
}
interface Site {
  id: string
  name: string
}

const EVENT_TYPE_LABEL: Record<EventType, string> = {
  FESTIVAL: 'Festival',
  CUSTOMER_MEET: 'Customer Meet',
  POSSESSION_CEREMONY: 'Possession Ceremony',
  PROJECT_LAUNCH: 'Project Launch',
  SITE_VISIT: 'Site Visit',
  OTHER: 'Other',
}

function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function EventsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const now = new Date()
  const [name, setName] = useState('')
  const [type, setType] = useState<EventType>('FESTIVAL')
  const [siteId, setSiteId] = useState('')
  const [venue, setVenue] = useState('')
  const [description, setDescription] = useState('')
  const [startAt, setStartAt] = useState(toLocalInput(now))
  const [endAt, setEndAt] = useState(toLocalInput(new Date(now.getTime() + 4 * 3600_000)))
  const [guestAccessOpensAt, setGuestAccessOpensAt] = useState(toLocalInput(now))
  const [guestAccessExpiresAt, setGuestAccessExpiresAt] = useState(toLocalInput(new Date(now.getTime() + 30 * 86400_000)))
  const [faceIndexDeleteAt, setFaceIndexDeleteAt] = useState(toLocalInput(new Date(now.getTime() + 45 * 86400_000)))
  const [originalPhotoRetentionUntil, setOriginalPhotoRetentionUntil] = useState(toLocalInput(new Date(now.getTime() + 90 * 86400_000)))
  const [likelyIncludesChildren, setLikelyIncludesChildren] = useState(false)

  const { data, isLoading } = useQuery({ queryKey: ['events'], queryFn: () => apiFetch<{ events: EventRow[] }>('/api/admin/events') })
  const { data: sitesData } = useQuery({ queryKey: ['sites'], queryFn: () => apiFetch<{ sites: Site[] }>('/api/admin/sites') })

  const createEvent = useMutation({
    mutationFn: () =>
      apiFetch<{ event: { id: string } }>('/api/admin/events', {
        method: 'POST',
        body: {
          name,
          type,
          siteId,
          venue,
          description: description || undefined,
          startAt: new Date(startAt).toISOString(),
          endAt: new Date(endAt).toISOString(),
          guestAccessOpensAt: new Date(guestAccessOpensAt).toISOString(),
          guestAccessExpiresAt: new Date(guestAccessExpiresAt).toISOString(),
          faceIndexDeleteAt: new Date(faceIndexDeleteAt).toISOString(),
          originalPhotoRetentionUntil: new Date(originalPhotoRetentionUntil).toISOString(),
          likelyIncludesChildren,
          guardianAssistedFlow: likelyIncludesChildren,
          selfieUploadFallbackEnabled: false,
        },
      }),
    onSuccess: (res) => {
      toastSuccess('Event created as Draft')
      queryClient.invalidateQueries({ queryKey: ['events'] })
      setDrawerOpen(false)
      navigate(`/admin/events/${res.event.id}`)
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Failed to create event'),
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Events</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Create and manage Neoteric Properties events.</p>
        </div>
        <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={() => setDrawerOpen(true)}>
          New event
        </Button>
      </div>

      {isLoading ? (
        <PageSpinner />
      ) : !data?.events.length ? (
        <Card>
          <EmptyState icon={CalendarDays} title="No events yet" description="Create an event to generate its guest QR code." />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900/40 text-gray-500 dark:text-gray-400 uppercase text-[11px]">
              <tr>
                <th className="text-left px-6 py-3 font-semibold">Event</th>
                <th className="text-left px-6 py-3 font-semibold hidden md:table-cell">Type</th>
                <th className="text-left px-6 py-3 font-semibold hidden md:table-cell">Venue</th>
                <th className="text-left px-6 py-3 font-semibold hidden sm:table-cell">Starts</th>
                <th className="text-left px-6 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {data.events.map((e) => (
                <tr
                  key={e.id}
                  className="hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors cursor-pointer"
                  onClick={() => navigate(`/admin/events/${e.id}`)}
                >
                  <td className="px-6 py-4 font-medium text-gray-900 dark:text-white">{e.name}</td>
                  <td className="px-6 py-4 text-gray-500 dark:text-gray-400 hidden md:table-cell">{EVENT_TYPE_LABEL[e.type]}</td>
                  <td className="px-6 py-4 text-gray-500 dark:text-gray-400 hidden md:table-cell">{e.venue}</td>
                  <td className="px-6 py-4 text-gray-500 dark:text-gray-400 hidden sm:table-cell">{new Date(e.startAt).toLocaleDateString()}</td>
                  <td className="px-6 py-4">
                    <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${EVENT_STATUS_BADGE[e.status]}`}>{e.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title="New event" width="lg" icon={<CalendarDays className="w-5 h-5 text-white" />}>
        <div className="space-y-4">
          {error && <FieldError>{error}</FieldError>}
          <div>
            <Label required>Event name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Diwali Customer Meet" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label required>Type</Label>
              <Select value={type} onChange={(v) => setType(v as EventType)} options={EVENT_TYPES.map((t) => ({ value: t, label: EVENT_TYPE_LABEL[t] }))} />
            </div>
            <div>
              <Label required>Site</Label>
              <Select value={siteId} onChange={setSiteId} options={(sitesData?.sites ?? []).map((s) => ({ value: s.id, label: s.name }))} placeholder="Choose a site" />
            </div>
          </div>
          <div>
            <Label required>Venue</Label>
            <Input value={venue} onChange={(e) => setVenue(e.target.value)} />
          </div>
          <div>
            <Label>Description</Label>
            <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label required>Start</Label>
              <Input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
            </div>
            <div>
              <Label required>End</Label>
              <Input type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label required>Guest access opens</Label>
              <Input type="datetime-local" value={guestAccessOpensAt} onChange={(e) => setGuestAccessOpensAt(e.target.value)} />
            </div>
            <div>
              <Label required>Guest access expires</Label>
              <Input type="datetime-local" value={guestAccessExpiresAt} onChange={(e) => setGuestAccessExpiresAt(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label required>Face index deletion date</Label>
              <Input type="datetime-local" value={faceIndexDeleteAt} onChange={(e) => setFaceIndexDeleteAt(e.target.value)} />
            </div>
            <div>
              <Label required>Original photo retention until</Label>
              <Input type="datetime-local" value={originalPhotoRetentionUntil} onChange={(e) => setOriginalPhotoRetentionUntil(e.target.value)} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input type="checkbox" checked={likelyIncludesChildren} onChange={(e) => setLikelyIncludesChildren(e.target.checked)} className="rounded" />
            This event is likely to include children — show additional guardian consent guidance
          </label>
          <p className="text-xs text-gray-400">You'll assign a consent version, upload photographs, and generate the QR code from the event page after creation.</p>
        </div>
        <div className="pt-2 flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setDrawerOpen(false)}>
            Cancel
          </Button>
          <Button variant="primary" loading={createEvent.isPending} onClick={() => createEvent.mutate()} disabled={!name || !siteId || !venue}>
            Create event (Draft)
          </Button>
        </div>
      </Drawer>
    </div>
  )
}
