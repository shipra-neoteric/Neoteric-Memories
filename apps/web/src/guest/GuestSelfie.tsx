import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Camera, RotateCcw, Upload, AlertTriangle } from 'lucide-react'
import { useGuestFlow } from './GuestFlowContext'
import { Button } from '../components/ui/Button'
import { ApiError, apiFetch } from '../lib/api'

// 'busy' = getUserMedia resolved to NotReadableError/TrackStartError (camera exists
// but is held by another app, or a hardware/driver fault) — distinct from 'denied'
// (user said no) and 'unavailable' (no camera device at all), since the fix for each
// is different. 'insecure' = the page itself isn't allowed to use the camera at all
// (see docs/PILOT_TESTING.md — only https:// or http://localhost are secure
// contexts; a plain http://<lan-ip> origin never even reaches getUserMedia).
type CameraState = 'requesting' | 'ready' | 'denied' | 'unavailable' | 'busy' | 'insecure'

const REJECTION_COPY: Record<string, string> = {
  INVALID_IMAGE: 'That did not look like a valid photo. Please try again.',
  NO_FACE_DETECTED: 'We could not detect a face. Make sure your face is clearly visible and well lit.',
  MULTIPLE_FACES_DETECTED: 'We detected more than one face. Please make sure only you are in the frame.',
  FACE_TOO_SMALL: 'Your face is too small in the frame. Please move closer.',
  PROCESSING_FAILED: 'Something went wrong while processing your selfie. Please try again.',
}

/** Downsamples the captured frame to a small grid and checks for near-uniform, near-black content — catches a broken/blocked camera producing a solid black frame that getUserMedia() itself has no way to detect (permission was genuinely granted). Never inspects/logs actual pixel values, only the derived mean/variance. */
function looksBlank(source: HTMLCanvasElement): boolean {
  const SAMPLE = 24
  const sampleCanvas = document.createElement('canvas')
  sampleCanvas.width = SAMPLE
  sampleCanvas.height = SAMPLE
  const ctx = sampleCanvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return false
  ctx.drawImage(source, 0, 0, SAMPLE, SAMPLE)
  const { data } = ctx.getImageData(0, 0, SAMPLE, SAMPLE)
  const n = SAMPLE * SAMPLE
  let sum = 0
  let sumSq = 0
  for (let i = 0; i < data.length; i += 4) {
    const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
    sum += luma
    sumSq += luma * luma
  }
  const mean = sum / n
  const variance = sumSq / n - mean * mean
  return mean < 8 && variance < 4
}

export function GuestSelfie() {
  const { sessionId, event, setSearchId } = useGuestFlow()
  const navigate = useNavigate()
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [cameraState, setCameraState] = useState<CameraState>('requesting')
  const [videoReady, setVideoReady] = useState(false)
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null)
  const [capturedUrl, setCapturedUrl] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [lockedOut, setLockedOut] = useState(false)

  useEffect(() => {
    // A secure context is required for getUserMedia at all (https://, or
    // http://localhost) — a plain http://<lan-ip> origin (e.g. testing from a phone
    // over local wifi) never reaches the permission prompt, and the resulting
    // failure otherwise looks identical to "no camera". Checking this explicitly
    // gives a correct, actionable message instead of a misleading one.
    if (!window.isSecureContext) {
      setCameraState('insecure')
      return
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraState('unavailable')
      return
    }
    let cancelled = false
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'user', width: { ideal: 720 } }, audio: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) videoRef.current.srcObject = stream
        setCameraState('ready')
      })
      .catch((err: unknown) => {
        // getUserMedia rejects with a DOMException whose `name` distinguishes why —
        // these three map to genuinely different fixes, so REJECTION_COPY-style
        // generic handling would hide that from the guest.
        const name = err instanceof DOMException ? err.name : ''
        if (name === 'NotReadableError' || name === 'TrackStartError') setCameraState('busy')
        else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') setCameraState('unavailable')
        else setCameraState('denied') // NotAllowedError/PermissionDeniedError, and any unrecognized failure
      })
    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  /** Fires on the video element's loadedmetadata/canplay — the earliest point at
   * which videoWidth/videoHeight are reliably non-zero and a captured frame will
   * actually contain a real image instead of whatever the canvas defaults to. */
  function handleVideoReady() {
    const video = videoRef.current
    if (video && video.videoWidth > 0 && video.videoHeight > 0) setVideoReady(true)
  }

  function capture() {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || !video.videoWidth || !video.videoHeight) {
      setErrorMessage('Camera is not ready yet. Please wait a moment and try again.')
      return
    }
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    ctx?.drawImage(video, 0, 0, canvas.width, canvas.height)

    if (looksBlank(canvas)) {
      setErrorMessage(
        'Your camera appears to be showing a black image. Check your camera privacy settings, close other apps using the camera, or try a different camera, then try again.'
      )
      return
    }

    canvas.toBlob(
      (blob) => {
        if (!blob || blob.size === 0) {
          setErrorMessage('Could not capture a photo. Please try again.')
          return
        }
        // Safe diagnostics only — never the image bytes themselves.
        // eslint-disable-next-line no-console
        console.log('[selfie] captured frame', { mimeType: blob.type, byteCount: blob.size, width: canvas.width, height: canvas.height })
        setCapturedBlob(blob)
        setCapturedUrl(URL.createObjectURL(blob))
      },
      'image/jpeg',
      0.9
    )
  }

  function retake() {
    setCapturedBlob(null)
    setCapturedUrl(null)
    setErrorMessage(null)
  }

  async function submitSelfie(blob: Blob, source: 'camera' | 'upload') {
    if (!sessionId) return
    setSubmitting(true)
    setErrorMessage(null)
    try {
      const form = new FormData()
      form.append('selfie', blob, 'selfie.jpg')
      const res = await apiFetch<{ ok: boolean; faceSearchId?: string; resultCount?: number; reason?: string; message?: string }>(
        `/api/guest/sessions/${sessionId}/selfie`,
        { method: 'POST', body: form, headers: { 'X-Capture-Source': source } }
      )
      if (!res.ok) {
        setErrorMessage(REJECTION_COPY[res.reason ?? ''] ?? res.message ?? 'Please try again.')
        setCapturedBlob(null)
        setCapturedUrl(null)
        return
      }
      setSearchId(res.faceSearchId!)
      navigate('../results')
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setLockedOut(true)
      } else if (err instanceof ApiError && err.status === 409) {
        setErrorMessage(err.message)
      } else {
        setErrorMessage(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
      }
      setCapturedBlob(null)
      setCapturedUrl(null)
    } finally {
      setSubmitting(false)
    }
  }

  if (lockedOut) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-center gap-3">
        <AlertTriangle className="w-8 h-8 text-amber-500" />
        <h1 className="text-base font-bold text-gray-900 dark:text-white">Maximum attempts reached</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 max-w-xs">
          You've reached the maximum number of selfie attempts for this session. Please contact event staff for help.
        </p>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col">
      <h1 className="text-lg font-bold text-gray-900 dark:text-white mb-1">Take a selfie</h1>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">Center your face in the frame, in good lighting, with only you visible.</p>

      {errorMessage && <p className="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2 mb-3">{errorMessage}</p>}

      <div className="relative aspect-[3/4] w-full bg-black rounded-xl overflow-hidden">
        {capturedUrl ? (
          <img src={capturedUrl} alt="Captured selfie" className="w-full h-full object-cover" />
        ) : cameraState === 'ready' ? (
          <>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              onLoadedMetadata={handleVideoReady}
              onCanPlay={handleVideoReady}
              className="w-full h-full object-cover -scale-x-100"
            />
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-[62%] aspect-[3/4] rounded-[50%] border-4 border-white/70" />
            </div>
            {!videoReady && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                <p className="text-sm text-white/80">Starting camera…</p>
              </div>
            )}
          </>
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center text-center gap-2 px-6">
            {cameraState === 'requesting' && <p className="text-sm text-white/70">Requesting camera access…</p>}
            {(cameraState === 'denied' || cameraState === 'unavailable' || cameraState === 'busy' || cameraState === 'insecure') && (
              <>
                <Camera className="w-8 h-8 text-white/40" />
                <p className="text-sm text-white/80">
                  {cameraState === 'denied' && 'Camera access was denied.'}
                  {cameraState === 'unavailable' && 'No camera is available on this device.'}
                  {cameraState === 'busy' && 'Your camera is busy or unavailable — it may be in use by another app.'}
                  {cameraState === 'insecure' && 'The camera is unavailable on this address (needs HTTPS to be accessible).'}
                </p>
                {event?.selfieUploadFallbackEnabled ? (
                  <p className="text-xs text-white/60">You can upload a photo instead below.</p>
                ) : (
                  <p className="text-xs text-white/60">Please enable camera access in your browser, or ask event staff for help.</p>
                )}
              </>
            )}
          </div>
        )}
      </div>
      <canvas ref={canvasRef} className="hidden" />

      <div className="mt-5 space-y-2">
        {capturedBlob ? (
          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" icon={<RotateCcw className="w-4 h-4" />} onClick={retake} disabled={submitting}>
              Retake
            </Button>
            <Button variant="primary" className="flex-1" loading={submitting} onClick={() => submitSelfie(capturedBlob, 'camera')}>
              Find my photos
            </Button>
          </div>
        ) : cameraState === 'ready' ? (
          <Button variant="primary" className="w-full py-3 text-base" icon={<Camera className="w-5 h-5" />} onClick={capture} disabled={!videoReady}>
            Capture selfie
          </Button>
        ) : null}

        {event?.selfieUploadFallbackEnabled && !capturedBlob && (
          <>
            <Button variant="secondary" className="w-full" icon={<Upload className="w-4 h-4" />} onClick={() => fileInputRef.current?.click()}>
              Upload a selfie instead
            </Button>
            <input
              ref={fileInputRef}
              data-testid="selfie-upload-input"
              type="file"
              accept="image/jpeg,image/png"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) void submitSelfie(file, 'upload')
                e.target.value = ''
              }}
            />
          </>
        )}
      </div>
    </div>
  )
}
