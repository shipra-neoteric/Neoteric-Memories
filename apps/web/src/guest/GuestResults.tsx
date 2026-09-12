import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Download, Flag, RotateCcw, Trash2, X, CheckSquare, Square, ImageOff } from 'lucide-react'
import { useGuestFlow } from './GuestFlowContext'
import { Button } from '../components/ui/Button'
import { PageSpinner } from '../components/ui/EmptyState'
import { apiFetch, ApiError } from '../lib/api'
import { confirmDialog, toastSuccess, toastError } from '../lib/toast'

interface ResultsResponse {
  status: string
  resultCount: number
  photos: { photoId: string; thumbUrl: string | null }[]
  disclaimer: string
}

export function GuestResults() {
  const { sessionId, searchId, token } = useGuestFlow()
  const navigate = useNavigate()
  const [data, setData] = useState<ResultsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [preview, setPreview] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [readyZipUrl, setReadyZipUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!sessionId || !searchId) return
    apiFetch<ResultsResponse>(`/api/guest/sessions/${sessionId}/searches/${searchId}/results`)
      .then((res) => {
        setData(res)
        setSelected(new Set(res.photos.map((p) => p.photoId)))
      })
      .finally(() => setLoading(false))
  }, [sessionId, searchId])

  if (!sessionId || !searchId) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center gap-3">
        <p className="text-sm text-gray-500">No recent search found for this session.</p>
        <Button variant="primary" onClick={() => navigate('../selfie')}>
          Take a selfie
        </Button>
      </div>
    )
  }

  if (loading || !data) return <PageSpinner />

  const allSelected = selected.size === data.photos.length && data.photos.length > 0

  function toggle(photoId: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(photoId)) next.delete(photoId)
      else next.add(photoId)
      return next
    })
  }

  async function downloadSingle(photoId: string) {
    if (!sessionId || !searchId) return
    // Opening the tab AFTER an await is no longer treated as user-initiated by most
    // mobile browsers, which then silently block it as a popup — nothing visibly
    // happens and it looks like "downloads don't work". Opening a blank tab
    // synchronously, inside the click handler, before any await, keeps it tied to
    // the user's tap; we just point it at the real URL once we have it.
    const win = window.open('', '_blank')
    try {
      const res = await apiFetch<{ url: string }>(`/api/guest/sessions/${sessionId}/searches/${searchId}/photos/${photoId}/download-url`)
      if (win) win.location.href = res.url
      else window.open(res.url, '_blank')
    } catch (err) {
      win?.close()
      toastError(err instanceof ApiError ? err.message : 'Download failed')
    }
  }

  async function downloadSelected() {
    if (!sessionId || !searchId || !data) return
    setDownloading(true)
    setReadyZipUrl(null)
    try {
      const res = await apiFetch<{ downloadJobId: string }>(`/api/guest/sessions/${sessionId}/searches/${searchId}/download-zip`, {
        method: 'POST',
        body: { photoIds: [...selected], all: selected.size === data.photos.length },
      })
      await pollDownload(sessionId, res.downloadJobId)
    } catch (err) {
      toastError(err instanceof ApiError ? err.message : 'Download failed')
    } finally {
      setDownloading(false)
    }
  }

  async function pollDownload(sid: string, downloadJobId: string) {
    // A ZIP can take a while to generate, so we deliberately do NOT window.open()
    // once it's ready — by then we're many seconds and several awaits past the
    // original click, and every mobile browser blocks that as a popup. Instead we
    // surface a real "Download ready" link/button below, so opening it is a fresh,
    // genuine user click that no popup blocker will touch.
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const status = await apiFetch<{ status: string; url: string | null }>(`/api/guest/sessions/${sid}/downloads/${downloadJobId}`)
      if (status.status === 'COMPLETED' && status.url) {
        setReadyZipUrl(status.url)
        return
      }
      if (status.status === 'FAILED') {
        toastError('We could not prepare your download. Please try again.')
        return
      }
      await new Promise((r) => setTimeout(r, 1500))
    }
    toastError('This is taking longer than expected. Please try again in a moment.')
  }

  async function reportWrongMatch(photoId: string) {
    if (!sessionId || !searchId) return
    const { isConfirmed, value } = await confirmDialog({ title: 'Report this as not you?', text: 'This helps us improve — event staff may review it.', input: 'text', inputPlaceholder: 'Optional note', confirmButtonText: 'Report' })
    if (!isConfirmed) return
    try {
      await apiFetch(`/api/guest/sessions/${sessionId}/searches/${searchId}/report-wrong-match`, { method: 'POST', body: { photoId, note: value || undefined } })
      toastSuccess('Thanks — this has been reported')
    } catch (err) {
      toastError(err instanceof ApiError ? err.message : 'Could not submit report')
    }
  }

  async function deleteSessionData() {
    if (!sessionId) return
    const { isConfirmed } = await confirmDialog({ title: 'Delete your search data?', text: 'This removes your search results and downloads from our systems. This cannot be undone.', danger: true, confirmButtonText: 'Delete my data' })
    if (!isConfirmed) return
    await apiFetch(`/api/guest/sessions/${sessionId}`, { method: 'DELETE' })
    sessionStorage.removeItem(`nm_search_${token}`)
    toastSuccess('Your session data has been deleted')
    navigate('..')
  }

  if (data.resultCount === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center gap-3">
        <ImageOff className="w-10 h-10 text-gray-300" />
        <h1 className="text-base font-bold text-gray-900 dark:text-white">No photos found</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 max-w-xs">
          We couldn't find a confident match for you in this event's photographs yet. This can happen if the lighting was different, your angle changed, or photos are still being processed.
        </p>
        <Button variant="primary" icon={<RotateCcw className="w-4 h-4" />} onClick={() => navigate('../selfie')}>
          Try again
        </Button>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h1 className="text-lg font-bold text-gray-900 dark:text-white">{data.resultCount} photo{data.resultCount === 1 ? '' : 's'} found</h1>
        </div>
        <button onClick={() => setSelected(allSelected ? new Set() : new Set(data.photos.map((p) => p.photoId)))} className="text-xs theme-text font-medium flex items-center gap-1">
          {allSelected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
          {allSelected ? 'Deselect all' : 'Select all'}
        </button>
      </div>

      <p className="text-[11px] text-gray-400 mb-3">{data.disclaimer}</p>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {data.photos.map((p) => (
          <div key={p.photoId} className="relative rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700 aspect-square bg-gray-100 dark:bg-gray-800">
            {p.thumbUrl ? (
              <img src={p.thumbUrl} alt="" className="w-full h-full object-cover cursor-pointer" onClick={() => setPreview(p.thumbUrl)} />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-gray-300">
                <ImageOff className="w-6 h-6" />
              </div>
            )}
            <button
              onClick={() => toggle(p.photoId)}
              className="absolute top-1.5 left-1.5 w-6 h-6 rounded-full bg-white/90 dark:bg-gray-900/80 flex items-center justify-center"
            >
              {selected.has(p.photoId) ? <CheckSquare className="w-4 h-4 theme-text" /> : <Square className="w-4 h-4 text-gray-400" />}
            </button>
            <div className="absolute bottom-1 right-1 flex gap-1">
              <button onClick={() => downloadSingle(p.photoId)} className="w-6 h-6 rounded-full bg-white/90 dark:bg-gray-900/80 flex items-center justify-center">
                <Download className="w-3.5 h-3.5 text-gray-600 dark:text-gray-300" />
              </button>
              <button onClick={() => reportWrongMatch(p.photoId)} className="w-6 h-6 rounded-full bg-white/90 dark:bg-gray-900/80 flex items-center justify-center">
                <Flag className="w-3.5 h-3.5 text-gray-600 dark:text-gray-300" />
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-5 space-y-2">
        {readyZipUrl ? (
          <Button
            variant="primary"
            className="w-full py-3"
            icon={<Download className="w-4 h-4" />}
            onClick={() => {
              window.open(readyZipUrl, '_blank')
              setReadyZipUrl(null)
            }}
          >
            Your download is ready — tap to open
          </Button>
        ) : (
          <Button variant="primary" className="w-full py-3" icon={<Download className="w-4 h-4" />} loading={downloading} disabled={selected.size === 0} onClick={downloadSelected}>
            Download {selected.size === data.photos.length ? 'all' : `selected (${selected.size})`}
          </Button>
        )}
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" icon={<RotateCcw className="w-4 h-4" />} onClick={() => navigate('../selfie')}>
            Search again
          </Button>
          <Button variant="ghost" className="flex-1" icon={<Trash2 className="w-4 h-4" />} onClick={deleteSessionData}>
            Delete my data
          </Button>
        </div>
      </div>

      {preview && (
        <div className="fixed inset-0 z-[10000] bg-black/90 flex items-center justify-center p-4" onClick={() => setPreview(null)}>
          <button className="absolute top-4 right-4 text-white" onClick={() => setPreview(null)}>
            <X className="w-6 h-6" />
          </button>
          <img src={preview} alt="" className="max-w-full max-h-full rounded-lg" />
        </div>
      )}
    </div>
  )
}
