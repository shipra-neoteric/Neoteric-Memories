import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CalendarDays,
  QrCode,
  Upload,
  Users,
  Play,
  Pause,
  Lock,
  Archive as ArchiveIcon,
  Trash2,
  RefreshCw,
  Download,
  AlertTriangle,
  ImageOff,
  CheckCircle2,
  Cloud,
  Link2,
  Unlink,
} from 'lucide-react'
import type { EventType, Role } from '@neoteric-memories/shared'
import { apiFetch, ApiError } from '../../lib/api'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Select } from '../../components/ui/Select'
import { PageSpinner } from '../../components/ui/EmptyState'
import { EVENT_STATUS_BADGE, PHOTO_STATUS_BADGE } from '../../lib/statusBadge'
import { toastError, toastSuccess, confirmDialog } from '../../lib/toast'
import { useAuth } from '../../context/AuthContext'

interface EventDetail {
  event: {
    id: string
    name: string
    type: EventType
    status: string
    venue: string
    startAt: string
    endAt: string
    guestAccessOpensAt: string
    guestAccessExpiresAt: string
    faceIndexDeleteAt: string
    originalPhotoRetentionUntil: string
    consentVersionId: string | null
    matchThreshold: number | null
    likelyIncludesChildren: boolean
    selfieUploadFallbackEnabled: boolean
  }
  photoStats: { status: string; _count: number }[]
  batches: { id: string; status: string; totalCount: number; processedCount: number; failedCount: number }[]
  assignments: { id: string; userId: string; role: string }[]
  indexedFaceCount: number
  hasActiveAccessToken: boolean
  accessTokenExpiresAt: string | null
}

interface Photo {
  id: string
  originalFilename: string
  status: string
  faceCount: number
  hasQualityWarning: boolean
  processingError?: string | null
}

interface ConsentVersion {
  id: string
  label: string
  isActive: boolean
}
interface AdminUser {
  id: string
  name: string
  role: Role
}

function useEventQuery(eventId: string) {
  return useQuery({ queryKey: ['event', eventId], queryFn: () => apiFetch<EventDetail>(`/api/admin/events/${eventId}`) })
}

export function EventDetailPage() {
  const { id } = useParams<{ id: string }>()
  const eventId = id!
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [searchParams, setSearchParams] = useSearchParams()

  useEffect(() => {
    const connected = searchParams.get('driveConnected')
    const driveErrorFlag = searchParams.get('driveError')
    if (!connected && !driveErrorFlag) return

    if (connected) toastSuccess('Google Drive connected — pick a folder below to start syncing')
    if (driveErrorFlag) toastError('Could not connect Google Drive. Please try again.')

    const next = new URLSearchParams(searchParams)
    next.delete('driveConnected')
    next.delete('driveError')
    setSearchParams(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const { data, isLoading } = useEventQuery(eventId)
  const { data: photosData } = useQuery({
    queryKey: ['event-photos', eventId],
    queryFn: () => apiFetch<{ photos: Photo[]; total: number }>(`/api/admin/events/${eventId}/photos?pageSize=100`),
    refetchInterval: 4000,
  })
  const { data: consentData } = useQuery({ queryKey: ['consent-versions'], queryFn: () => apiFetch<{ consentVersions: ConsentVersion[] }>('/api/admin/consent-versions') })
  const { data: usersData } = useQuery({ queryKey: ['users'], queryFn: () => apiFetch<{ users: AdminUser[] }>('/api/admin/users') })

  const [qrResult, setQrResult] = useState<{ guestUrl: string; qrPngDataUrl: string; expiresAt: string } | null>(null)

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['event', eventId] })
    queryClient.invalidateQueries({ queryKey: ['event-photos', eventId] })
  }

  // Drives photo processing forward without an always-on worker: on a serverless
  // deployment nothing is continuously polling the job queue on its own (see
  // apps/api/api/index.js's own doc comment), so after an upload finishes, this admin
  // page itself calls POST .../jobs/process-next once per still-queued job,
  // sequentially (never more than one in flight — a second call only ever starts
  // after the previous one's response), until the batch is done. Bounded by
  // MAX_DRAIN_ATTEMPTS so a single browser tab can't loop forever if something's
  // stuck — the GitHub Actions recovery cron (backend-cron.yml) and the "Resume
  // processing" button (shown whenever photos are still PENDING/PROCESSING, computed
  // straight from the polled photo list, so it survives a refresh without needing to
  // remember which batch was in progress) both exist to pick up from wherever this
  // loop left off.
  const MAX_DRAIN_ATTEMPTS = 80
  const [isDraining, setIsDraining] = useState(false)

  const drainPhotoJobs = async (batchId?: string) => {
    setIsDraining(true)
    try {
      for (let attempt = 0; attempt < MAX_DRAIN_ATTEMPTS; attempt++) {
        const res = await apiFetch<{
          processed: boolean
          jobId?: string
          jobType?: string
          remainingForBatch?: number
          result?: 'completed' | 'failed' | 'nothing_to_process'
        }>(`/api/admin/events/${eventId}/jobs/process-next`, { method: 'POST', body: batchId ? { batchId } : {} })

        queryClient.invalidateQueries({ queryKey: ['event-photos', eventId] })
        if (!res.processed || (res.remainingForBatch ?? 0) === 0) break
      }
    } catch (err) {
      toastError(err instanceof ApiError ? err.message : 'Photo processing was interrupted — use "Resume processing" to continue')
    } finally {
      setIsDraining(false)
      invalidate()
    }
  }

  const pendingPhotoCount = (photosData?.photos ?? []).filter((p) => p.status === 'PENDING' || p.status === 'PROCESSING').length

  const updateEvent = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiFetch(`/api/admin/events/${eventId}`, { method: 'PATCH', body }),
    onSuccess: () => {
      toastSuccess('Event updated')
      invalidate()
    },
    onError: (err) => toastError(err instanceof ApiError ? err.message : 'Update failed'),
  })

  const transitionStatus = useMutation({
    mutationFn: (status: string) => apiFetch(`/api/admin/events/${eventId}/status`, { method: 'POST', body: { status } }),
    onSuccess: () => {
      toastSuccess('Event status updated')
      invalidate()
    },
    onError: (err) => toastError(err instanceof ApiError ? err.message : 'Could not change status'),
  })

  const generateQr = useMutation({
    mutationFn: () => apiFetch<{ guestUrl: string; qrPngDataUrl: string; expiresAt: string }>(`/api/admin/events/${eventId}/access-token`, { method: 'POST' }),
    onSuccess: (res) => {
      setQrResult(res)
      toastSuccess('QR code generated — save it now, it will not be shown again')
      invalidate()
    },
    onError: (err) => toastError(err instanceof ApiError ? err.message : 'Failed to generate QR'),
  })

  const revokeQr = useMutation({
    mutationFn: () => apiFetch(`/api/admin/events/${eventId}/access-token/revoke`, { method: 'POST', body: { reason: 'Manually disabled by admin' } }),
    onSuccess: () => {
      toastSuccess('Guest QR/link disabled')
      setQrResult(null)
      invalidate()
    },
  })

  const uploadPhotos = useMutation({
    // Takes a plain File[] (already extracted from the input), not a live FileList —
    // the input's `value` gets reset to '' right after mutate() is called so the
    // picker can be reused, and FileList is a *live* view of the input's current
    // state, so a FileList reference would already be empty by the time this async
    // function runs if we didn't copy it out first.
    //
    // Uploads go straight from this browser to storage via a presigned URL per file,
    // never through this app's own API request body — Vercel hard-rejects any
    // request over ~4.5MB regardless of backend code, which a single real phone
    // photo can already exceed on its own. presign/finalize are both tiny JSON
    // requests; only the PUT in between carries the actual file bytes, and it goes
    // directly to storage.
    mutationFn: async (files: File[]) => {
      const presigned = await apiFetch<{
        files: { filename: string; photoId: string; key: string; uploadUrl: string; headers: Record<string, string> }[]
      }>(`/api/admin/events/${eventId}/photos/presign`, {
        method: 'POST',
        body: { files: files.map((f) => ({ filename: f.name, contentType: f.type || 'application/octet-stream' })) },
      })

      const uploaded: { key: string; photoId: string; filename: string }[] = []
      let uploadFailures = 0
      await Promise.all(
        presigned.files.map(async (p, i) => {
          try {
            const res = await fetch(p.uploadUrl, { method: 'PUT', headers: p.headers, body: files[i] })
            if (!res.ok) throw new Error(`upload failed with status ${res.status}`)
            uploaded.push({ key: p.key, photoId: p.photoId, filename: p.filename })
          } catch {
            uploadFailures += 1
          }
        })
      )

      if (uploaded.length === 0) {
        throw new ApiError(0, 'UPLOAD_FAILED', 'None of the selected files could be uploaded. Check your connection and try again.')
      }

      const result = await apiFetch<{
        accepted: { photoId: string; filename: string }[]
        duplicates: unknown[]
        rejected: { filename: string; reason: string }[]
        batchId: string | null
      }>(`/api/admin/events/${eventId}/photos/finalize`, { method: 'POST', body: { files: uploaded } })
      return { ...result, uploadFailures }
    },
    onSuccess: (res) => {
      if (res.accepted.length) toastSuccess(`${res.accepted.length} photo(s) uploaded — processing now`)
      if (res.duplicates.length) toastError(`${res.duplicates.length} file(s) skipped as duplicates`)
      if (res.rejected.length) toastError(`${res.rejected.length} file(s) rejected: ${res.rejected[0].reason}`)
      if (res.uploadFailures > 0) toastError(`${res.uploadFailures} file(s) failed to upload — try again`)
      invalidate()
      if (res.accepted.length > 0) void drainPhotoJobs(res.batchId ?? undefined)
    },
    onError: (err) => toastError(err instanceof ApiError ? err.message : 'Upload failed'),
  })

  const retryPhoto = useMutation({
    mutationFn: (photoId: string) => apiFetch(`/api/admin/events/${eventId}/photos/${photoId}/retry`, { method: 'POST' }),
    onSuccess: () => {
      invalidate()
      void drainPhotoJobs()
    },
  })

  const deletePhoto = useMutation({
    mutationFn: (photoId: string) => apiFetch(`/api/admin/events/${eventId}/photos/${photoId}`, { method: 'DELETE' }),
    onSuccess: () => {
      toastSuccess('Photo deleted')
      invalidate()
    },
  })

  const assignMember = useMutation({
    mutationFn: (body: { userId: string; role: 'EVENT_MANAGER' | 'PHOTOGRAPHER' }) =>
      apiFetch(`/api/admin/events/${eventId}/assignments`, { method: 'POST', body }),
    onSuccess: () => {
      toastSuccess('Team member assigned')
      invalidate()
    },
  })

  const deleteEvent = useMutation({
    mutationFn: () => apiFetch(`/api/admin/events/${eventId}`, { method: 'DELETE' }),
    onSuccess: () => {
      toastSuccess('Event and all its data have been permanently deleted')
      window.location.href = '/admin/events'
    },
  })

  if (isLoading || !data) return <PageSpinner />
  const { event } = data

  const statusActions: { label: string; target: string; icon: typeof Play; variant: 'primary' | 'secondary' | 'danger' }[] = []
  if (event.status === 'READY' || event.status === 'PAUSED') statusActions.push({ label: 'Go Live', target: 'LIVE', icon: Play, variant: 'primary' })
  if (event.status === 'LIVE') statusActions.push({ label: 'Pause', target: 'PAUSED', icon: Pause, variant: 'secondary' })
  if (['LIVE', 'PAUSED', 'READY'].includes(event.status)) statusActions.push({ label: 'Close event', target: 'CLOSED', icon: Lock, variant: 'danger' })
  if (['CLOSED', 'EXPIRED'].includes(event.status)) statusActions.push({ label: 'Archive', target: 'ARCHIVED', icon: ArchiveIcon, variant: 'secondary' })

  const totalPhotos = data.photoStats.reduce((s, p) => s + p._count, 0)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{event.name}</h1>
            <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${EVENT_STATUS_BADGE[event.status]}`}>{event.status}</span>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {event.venue} · {new Date(event.startAt).toLocaleString()}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {statusActions.map((a) => (
            <Button
              key={a.target}
              variant={a.variant}
              icon={<a.icon className="w-4 h-4" />}
              loading={transitionStatus.isPending}
              onClick={async () => {
                if (a.target === 'CLOSED') {
                  const { isConfirmed } = await confirmDialog({ title: 'Close this event?', text: 'Guests will no longer be able to search for photos.', danger: true, confirmButtonText: 'Close event' })
                  if (!isConfirmed) return
                }
                transitionStatus.mutate(a.target)
              }}
            >
              {a.label}
            </Button>
          ))}
          {user?.role === 'MASTER_ADMIN' && (
            <Button
              variant="danger"
              icon={<Trash2 className="w-4 h-4" />}
              onClick={async () => {
                const { isConfirmed } = await confirmDialog({
                  title: 'Permanently delete this event?',
                  text: 'This deletes all photos, indexed faces, guest sessions and search history. This cannot be undone.',
                  danger: true,
                  confirmButtonText: 'Delete everything',
                })
                if (isConfirmed) deleteEvent.mutate()
              }}
            >
              Delete event
            </Button>
          )}
        </div>
      </div>

      {(event.status === 'DRAFT' || event.status === 'UPLOADING' || event.status === 'PROCESSING') && (
        <ReadinessBanner eventId={eventId} />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card className="p-5">
            <SectionTitle icon={CalendarDays}>Event details</SectionTitle>
            <div className="grid grid-cols-2 gap-4 mt-3">
              <Field label="Consent version">
                <Select
                  value={event.consentVersionId ?? undefined}
                  onChange={(v) => updateEvent.mutate({ consentVersionId: v })}
                  options={(consentData?.consentVersions ?? []).map((c) => ({ value: c.id, label: c.label }))}
                  placeholder="Not assigned"
                />
              </Field>
              <Field label="Likely includes children">
                <label className="flex items-center gap-2 text-sm mt-2">
                  <input
                    type="checkbox"
                    checked={event.likelyIncludesChildren}
                    onChange={(e) => updateEvent.mutate({ likelyIncludesChildren: e.target.checked, guardianAssistedFlow: e.target.checked })}
                  />
                  Show guardian guidance
                </label>
              </Field>
              <Field label="Guest access window">
                <p className="text-sm">{new Date(event.guestAccessOpensAt).toLocaleString()} → {new Date(event.guestAccessExpiresAt).toLocaleString()}</p>
              </Field>
              <Field label="Face index deletion">
                <p className="text-sm">{new Date(event.faceIndexDeleteAt).toLocaleDateString()}</p>
              </Field>
              <Field label="Original photo retention until">
                <p className="text-sm">{new Date(event.originalPhotoRetentionUntil).toLocaleDateString()}</p>
              </Field>
              <Field label="Selfie upload fallback (no camera)">
                <label className="flex items-center gap-2 text-sm mt-2">
                  <input
                    type="checkbox"
                    checked={event.selfieUploadFallbackEnabled}
                    onChange={(e) => updateEvent.mutate({ selfieUploadFallbackEnabled: e.target.checked })}
                  />
                  Allow uploading a photo instead of live camera
                </label>
              </Field>
            </div>
          </Card>

          <Card className="p-5">
            <div className="flex items-center justify-between mb-3">
              <SectionTitle icon={Upload}>Photographs ({totalPhotos})</SectionTitle>
              <Button variant="primary" icon={<Upload className="w-4 h-4" />} onClick={() => fileInputRef.current?.click()} loading={uploadPhotos.isPending}>
                Upload photos
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/heic,image/heif,.heic,.heif"
                multiple
                hidden
                onChange={(e) => {
                  const files = e.target.files ? Array.from(e.target.files) : []
                  e.target.value = ''
                  if (files.length > 0) uploadPhotos.mutate(files)
                }}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2 mb-4">
              {data.photoStats.map((s) => (
                <span key={s.status} className={`px-2.5 py-1 rounded-full text-xs font-medium ${PHOTO_STATUS_BADGE[s.status] ?? 'bg-gray-100 text-gray-600'}`}>
                  {s.status}: {s._count}
                </span>
              ))}
              {isDraining && (
                <span className="text-xs text-gray-400 flex items-center gap-1.5">
                  <RefreshCw className="w-3 h-3 animate-spin" /> Processing…
                </span>
              )}
              {!isDraining && pendingPhotoCount > 0 && (
                // Shown whenever the poll picks up PENDING/PROCESSING photos with no
                // drain loop currently running for them — covers a page refresh
                // mid-batch, a closed tab, or the bounded drain loop above having
                // given up after MAX_DRAIN_ATTEMPTS. Deliberately reads server state
                // (the photo list) rather than any client-side "was I uploading"
                // flag, so it works correctly no matter how the page got here.
                <Button variant="secondary" className="!py-1 !px-2.5 text-xs" icon={<RefreshCw className="w-3 h-3" />} onClick={() => void drainPhotoJobs()}>
                  Resume processing ({pendingPhotoCount})
                </Button>
              )}
            </div>
            {!photosData?.photos.length ? (
              <div className="text-center py-10 text-sm text-gray-400">
                <ImageOff className="w-8 h-8 mx-auto mb-2" />
                No photographs uploaded yet.
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {photosData.photos.map((p) => (
                  <div key={p.id} className="border border-gray-200 dark:border-gray-700 rounded-lg p-2.5 bg-gray-50 dark:bg-gray-900/40">
                    <p className="text-xs font-medium text-gray-700 dark:text-gray-200 truncate" title={p.originalFilename}>
                      {p.originalFilename}
                    </p>
                    <div className="flex items-center justify-between mt-1.5">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${PHOTO_STATUS_BADGE[p.status] ?? ''}`}>{p.status}</span>
                      <span className="text-[10px] text-gray-400">{p.faceCount} face(s)</span>
                    </div>
                    {p.hasQualityWarning && <p className="text-[10px] text-amber-600 mt-1 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Low quality</p>}
                    {p.status === 'FAILED' && p.processingError && (
                      <p className="text-[10px] text-red-500 mt-1 line-clamp-2" title={p.processingError}>{p.processingError}</p>
                    )}
                    <div className="flex gap-1 mt-2">
                      {p.status === 'FAILED' && (
                        <button onClick={() => retryPhoto.mutate(p.id)} className="text-[11px] flex items-center gap-1 text-blue-600 hover:underline">
                          <RefreshCw className="w-3 h-3" /> Retry
                        </button>
                      )}
                      <button
                        onClick={async () => {
                          const { isConfirmed } = await confirmDialog({ title: 'Delete this photo?', danger: true, confirmButtonText: 'Delete' })
                          if (isConfirmed) deletePhoto.mutate(p.id)
                        }}
                        className="text-[11px] flex items-center gap-1 text-red-500 hover:underline ml-auto"
                      >
                        <Trash2 className="w-3 h-3" /> Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="p-5">
            <SectionTitle icon={QrCode}>Guest QR code</SectionTitle>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 mb-3">
              {data.hasActiveAccessToken ? `Active — expires ${data.accessTokenExpiresAt ? new Date(data.accessTokenExpiresAt).toLocaleDateString() : ''}` : 'No active QR/link yet.'}
            </p>
            {qrResult ? (
              <div className="text-center">
                <img src={qrResult.qrPngDataUrl} alt="Guest QR code" className="mx-auto w-40 h-40 rounded-lg border border-gray-200 dark:border-gray-700" />
                <p className="text-[11px] text-gray-500 mt-2 break-all">{qrResult.guestUrl}</p>
                <p className="text-[11px] text-amber-600 mt-2">This link is shown only once — download or print it now.</p>
                <a href={qrResult.qrPngDataUrl} download={`${event.name.replace(/\s+/g, '-')}-qr.png`}>
                  <Button variant="secondary" className="w-full mt-2" icon={<Download className="w-4 h-4" />}>
                    Download QR PNG
                  </Button>
                </a>
              </div>
            ) : (
              <div className="w-40 h-40 mx-auto rounded-lg border border-dashed border-gray-300 dark:border-gray-600 flex items-center justify-center text-gray-300">
                <QrCode className="w-10 h-10" />
              </div>
            )}
            <div className="flex gap-2 mt-3">
              <Button variant="primary" className="flex-1" loading={generateQr.isPending} onClick={() => generateQr.mutate()}>
                {data.hasActiveAccessToken ? 'Regenerate QR' : 'Generate QR'}
              </Button>
              {data.hasActiveAccessToken && (
                <Button
                  variant="danger"
                  onClick={async () => {
                    const { isConfirmed } = await confirmDialog({ title: 'Disable guest access?', text: 'The current QR/link will stop working immediately.', danger: true, confirmButtonText: 'Disable' })
                    if (isConfirmed) revokeQr.mutate()
                  }}
                >
                  Disable
                </Button>
              )}
            </div>
          </Card>

          <Card className="p-5">
            <SectionTitle icon={Users}>Team</SectionTitle>
            <div className="space-y-2 mt-3">
              {data.assignments.length === 0 && <p className="text-sm text-gray-400">No one assigned yet.</p>}
              {data.assignments.map((a) => {
                const u = usersData?.users.find((x) => x.id === a.userId)
                return (
                  <div key={a.id} className="flex items-center justify-between text-sm">
                    <span className="text-gray-700 dark:text-gray-200">{u?.name ?? a.userId}</span>
                    <span className="text-xs text-gray-400">{a.role}</span>
                  </div>
                )
              })}
            </div>
            <AssignForm
              users={(usersData?.users ?? []).filter((u) => ['EVENT_MANAGER', 'PHOTOGRAPHER'].includes(u.role) && !data.assignments.some((a) => a.userId === u.id))}
              onAssign={(userId, role) => assignMember.mutate({ userId, role })}
            />
          </Card>

          <DriveIntegrationCard eventId={eventId} onPhotosImported={() => void drainPhotoJobs()} />

          <Card className="p-5">
            <SectionTitle icon={CheckCircle2}>Face index status</SectionTitle>
            <p className="text-sm text-gray-600 dark:text-gray-300 mt-2">{data.indexedFaceCount} face(s) indexed in this event's private collection.</p>
            <p className="text-[11px] text-gray-400 mt-1">Collection is fully isolated per event — never shared or searched across events.</p>
          </Card>
        </div>
      </div>
    </div>
  )
}

function SectionTitle({ icon: Icon, children }: { icon: typeof CalendarDays; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="w-4 h-4 theme-text" />
      <h3 className="text-xs font-bold uppercase tracking-wide text-gray-600 dark:text-gray-300">{children}</h3>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-[9px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-1">{label}</p>
      {children}
    </div>
  )
}

function AssignForm({ users, onAssign }: { users: AdminUser[]; onAssign: (userId: string, role: 'EVENT_MANAGER' | 'PHOTOGRAPHER') => void }) {
  const [userId, setUserId] = useState('')
  const [role, setRole] = useState<'EVENT_MANAGER' | 'PHOTOGRAPHER'>('PHOTOGRAPHER')
  if (users.length === 0) return null
  return (
    <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700 space-y-2">
      <Select value={userId} onChange={setUserId} options={users.map((u) => ({ value: u.id, label: `${u.name} (${u.role})` }))} placeholder="Choose a team member" />
      <div className="flex gap-2">
        <Select value={role} onChange={(v) => setRole(v as 'EVENT_MANAGER' | 'PHOTOGRAPHER')} options={[{ value: 'PHOTOGRAPHER', label: 'Photographer' }, { value: 'EVENT_MANAGER', label: 'Event Manager' }]} />
        <Button
          variant="secondary"
          disabled={!userId}
          onClick={() => {
            onAssign(userId, role)
            setUserId('')
          }}
        >
          Assign
        </Button>
      </div>
    </div>
  )
}

interface DriveIntegration {
  id: string
  googleAccountEmail: string | null
  folderId: string | null
  folderName: string | null
  status: 'PENDING_FOLDER' | 'ACTIVE' | 'PAUSED' | 'ERROR'
  lastSyncedAt: string | null
  lastError: string | null
  lastSyncSummary: string | null
  importedCount: number
}

function DriveIntegrationCard({ eventId, onPhotosImported }: { eventId: string; onPhotosImported: () => void }) {
  const queryClient = useQueryClient()
  const [folderInput, setFolderInput] = useState('')
  const [isSyncing, setIsSyncing] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['drive-integration', eventId],
    queryFn: () => apiFetch<{ enabled: boolean; integration: DriveIntegration | null }>(`/api/admin/events/${eventId}/drive`),
    refetchInterval: 15000,
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['drive-integration', eventId] })

  const connect = useMutation({
    mutationFn: () => apiFetch<{ url: string }>(`/api/admin/events/${eventId}/drive/connect`),
    onSuccess: (res) => {
      window.location.href = res.url
    },
    onError: (err) => toastError(err instanceof ApiError ? err.message : 'Could not start Google Drive connection'),
  })

  const setFolder = useMutation({
    mutationFn: () => apiFetch(`/api/admin/events/${eventId}/drive/folder`, { method: 'POST', body: { folder: folderInput } }),
    onSuccess: () => {
      toastSuccess('Drive folder connected — new photos will sync automatically')
      setFolderInput('')
      invalidate()
    },
    onError: (err) => toastError(err instanceof ApiError ? err.message : 'Could not connect that folder'),
  })

  // Enqueues and immediately processes one bounded chunk of the Drive folder
  // (MAX_FILES_PER_SYNC_RUN files — see modules/drive/service.ts) per call, entirely
  // within this one request/response — no background/202 response needed, since a
  // single chunk is small enough to stay well under a reasonable request time. A
  // folder with more new files than fit in one chunk says so in lastSyncSummary ("N
  // more queued for the next sync"); this loop keeps calling sync-now, bounded by
  // MAX_SYNC_ATTEMPTS, until that phrase is gone — the manual-click equivalent of
  // what the periodic GitHub Actions recovery cron would otherwise take several
  // 5-minute ticks to work through on its own.
  const MAX_SYNC_ATTEMPTS = 20
  const runSyncNow = async () => {
    setIsSyncing(true)
    try {
      let importedAny = false
      for (let attempt = 0; attempt < MAX_SYNC_ATTEMPTS; attempt++) {
        const res = await apiFetch<{
          processed: boolean
          result?: 'completed' | 'failed' | 'nothing_to_process'
          integration: DriveIntegration | null
        }>(`/api/admin/events/${eventId}/drive/sync-now`, { method: 'POST' })

        queryClient.setQueryData(['drive-integration', eventId], (prev: { enabled: boolean; integration: DriveIntegration | null } | undefined) =>
          prev ? { ...prev, integration: res.integration } : prev
        )
        if (res.processed && res.result === 'completed') importedAny = true
        if (!res.processed || !res.integration?.lastSyncSummary?.includes('more queued')) break
      }
      if (importedAny) onPhotosImported()
      toastSuccess('Drive sync finished — see the summary below.')
    } catch (err) {
      toastError(err instanceof ApiError ? err.message : 'Could not run the sync')
    } finally {
      setIsSyncing(false)
      invalidate()
    }
  }

  const togglePause = useMutation({
    mutationFn: (resume: boolean) => apiFetch(`/api/admin/events/${eventId}/drive/${resume ? 'resume' : 'pause'}`, { method: 'POST' }),
    onSuccess: invalidate,
  })

  const disconnect = useMutation({
    mutationFn: () => apiFetch(`/api/admin/events/${eventId}/drive`, { method: 'DELETE' }),
    onSuccess: () => {
      toastSuccess('Google Drive disconnected')
      invalidate()
    },
  })

  if (isLoading || !data) return null
  if (!data.enabled) return null // Google OAuth isn't configured on this server — hide the whole feature rather than show a dead button.

  const integration = data.integration

  return (
    <Card className="p-5">
      <SectionTitle icon={Cloud}>Google Drive sync</SectionTitle>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 mb-3">
        Automatically import new photos from a Drive folder every few minutes, instead of uploading manually.
      </p>

      {!integration && (
        <Button variant="primary" className="w-full" icon={<Link2 className="w-4 h-4" />} loading={connect.isPending} onClick={() => connect.mutate()}>
          Connect Google Drive
        </Button>
      )}

      {integration && (
        <div className="space-y-3">
          <div className="text-xs text-gray-500 dark:text-gray-400">
            Connected as <span className="font-medium text-gray-700 dark:text-gray-300">{integration.googleAccountEmail ?? 'unknown account'}</span>
          </div>

          {integration.status === 'PENDING_FOLDER' && (
            <div className="space-y-2">
              <p className="text-xs text-gray-500 dark:text-gray-400">Paste the Drive folder link (or folder ID) to sync from:</p>
              <div className="flex gap-2">
                <input
                  value={folderInput}
                  onChange={(e) => setFolderInput(e.target.value)}
                  placeholder="https://drive.google.com/drive/folders/..."
                  className="flex-1 px-3 py-2 border rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm border-gray-300 dark:border-gray-600"
                />
                <Button variant="primary" loading={setFolder.isPending} disabled={!folderInput} onClick={() => setFolder.mutate()}>
                  Set folder
                </Button>
              </div>
              <p className="text-[11px] text-amber-600">
                Make sure the Drive folder is shared with (or owned by) the Google account you just connected.
              </p>
            </div>
          )}

          {integration.folderId && (
            <>
              <div className="text-sm">
                <p className="font-medium text-gray-800 dark:text-gray-200 truncate">{integration.folderName ?? integration.folderId}</p>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  {integration.status === 'ACTIVE' && 'Syncing automatically'}
                  {integration.status === 'PAUSED' && 'Paused'}
                  {integration.status === 'ERROR' && 'Last sync failed'}
                  {' · '}
                  {integration.importedCount} photo(s) imported
                  {integration.lastSyncedAt && ` · last synced ${new Date(integration.lastSyncedAt).toLocaleTimeString()}`}
                </p>
                {integration.status === 'ERROR' && integration.lastError && (
                  <p className="text-[11px] text-red-500 mt-1">{integration.lastError}</p>
                )}
                {integration.status !== 'ERROR' && integration.lastSyncSummary && (
                  <p className="text-[11px] text-gray-400 mt-1">{integration.lastSyncSummary}</p>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" icon={<RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />} loading={isSyncing} onClick={() => void runSyncNow()}>
                  {isSyncing ? 'Syncing…' : 'Sync now'}
                </Button>
                {integration.status === 'PAUSED' || integration.status === 'ERROR' ? (
                  <Button variant="secondary" icon={<Play className="w-3.5 h-3.5" />} loading={togglePause.isPending} onClick={() => togglePause.mutate(true)}>
                    Resume
                  </Button>
                ) : (
                  <Button variant="secondary" icon={<Pause className="w-3.5 h-3.5" />} loading={togglePause.isPending} onClick={() => togglePause.mutate(false)}>
                    Pause
                  </Button>
                )}
                <Button
                  variant="ghost"
                  icon={<Unlink className="w-3.5 h-3.5" />}
                  onClick={async () => {
                    const { isConfirmed } = await confirmDialog({ title: 'Disconnect Google Drive?', text: 'Already-imported photos stay — only the sync connection is removed.', danger: true, confirmButtonText: 'Disconnect' })
                    if (isConfirmed) disconnect.mutate()
                  }}
                >
                  Disconnect
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </Card>
  )
}

function ReadinessBanner({ eventId }: { eventId: string }) {
  const { data } = useQuery({
    queryKey: ['event-readiness', eventId],
    queryFn: () => apiFetch<{ ready: boolean; reasons: string[] }>(`/api/admin/events/${eventId}/readiness`),
    refetchInterval: 5000,
  })
  if (!data || data.ready) return null
  return (
    <div className="bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/40 rounded-xl p-3.5 flex items-start gap-3">
      <div className="w-8 h-8 bg-amber-100 dark:bg-amber-900/30 rounded-lg flex items-center justify-center flex-shrink-0">
        <AlertTriangle className="w-4 h-4 text-amber-500" />
      </div>
      <div>
        <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">Not ready to go live yet</p>
        <ul className="text-xs text-amber-700 dark:text-amber-400 list-disc pl-4 mt-1 space-y-0.5">
          {data.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </div>
    </div>
  )
}
