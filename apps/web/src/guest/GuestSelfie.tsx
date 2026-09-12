import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Camera, RotateCcw, Upload, AlertTriangle } from 'lucide-react'
import { useGuestFlow } from './GuestFlowContext'
import { Button } from '../components/ui/Button'
import { ApiError, apiFetch } from '../lib/api'

type CameraState = 'requesting' | 'ready' | 'denied' | 'unavailable'

const REJECTION_COPY: Record<string, string> = {
  INVALID_IMAGE: 'That did not look like a valid photo. Please try again.',
  NO_FACE_DETECTED: 'We could not detect a face. Make sure your face is clearly visible and well lit.',
  MULTIPLE_FACES_DETECTED: 'We detected more than one face. Please make sure only you are in the frame.',
  FACE_TOO_SMALL: 'Your face is too small in the frame. Please move closer.',
  PROCESSING_FAILED: 'Something went wrong while processing your selfie. Please try again.',
}

export function GuestSelfie() {
  const { sessionId, event, setSearchId } = useGuestFlow()
  const navigate = useNavigate()
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [cameraState, setCameraState] = useState<CameraState>('requesting')
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null)
  const [capturedUrl, setCapturedUrl] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [lockedOut, setLockedOut] = useState(false)

  useEffect(() => {
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
      .catch(() => setCameraState('denied'))
    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  function capture() {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    ctx?.drawImage(video, 0, 0, canvas.width, canvas.height)
    canvas.toBlob(
      (blob) => {
        if (!blob) return
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
            <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover -scale-x-100" />
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="w-[62%] aspect-[3/4] rounded-[50%] border-4 border-white/70" />
            </div>
          </>
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center text-center gap-2 px-6">
            {cameraState === 'requesting' && <p className="text-sm text-white/70">Requesting camera access…</p>}
            {(cameraState === 'denied' || cameraState === 'unavailable') && (
              <>
                <Camera className="w-8 h-8 text-white/40" />
                <p className="text-sm text-white/80">
                  {cameraState === 'denied' ? 'Camera access was denied.' : 'No camera is available on this device.'}
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
          <Button variant="primary" className="w-full py-3 text-base" icon={<Camera className="w-5 h-5" />} onClick={capture}>
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
