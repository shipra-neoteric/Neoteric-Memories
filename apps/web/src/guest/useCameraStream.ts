import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * 'busy' = getUserMedia (or video.play()) failed with NotReadableError/
 * TrackStartError — camera exists but is held by another app, or a hardware/driver
 * fault — distinct from 'denied' (user said no) and 'unavailable' (no camera device
 * at all), since the fix for each is different. 'insecure' = the page itself isn't
 * allowed to use the camera at all (only https:// or http://localhost are secure
 * contexts — a plain http://<lan-ip> origin never even reaches getUserMedia).
 * 'timeout' = a stream was granted and play() resolved, but no frame with real
 * dimensions ever arrived within INIT_TIMEOUT_MS. 'initializing' = a stream was
 * granted and attached, distinct from 'requesting' (still waiting on
 * getUserMedia/the permission prompt) — this is the "Starting camera…" phase.
 */
export type CameraState = 'requesting' | 'initializing' | 'ready' | 'denied' | 'unavailable' | 'busy' | 'insecure' | 'timeout'

export const INIT_TIMEOUT_MS = 10_000

const READY_EVENTS = ['loadedmetadata', 'loadeddata', 'canplay', 'playing', 'resize'] as const

function isVideoReady(video: HTMLVideoElement): boolean {
  return video.videoWidth > 0 && video.videoHeight > 0 && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
}

/** Never logs pixel/image data — only metadata safe to appear in console/telemetry. */
function logSafeDiagnostics(label: string, video: HTMLVideoElement | null, stream: MediaStream | null): void {
  const track = stream?.getVideoTracks()[0]
  const report = {
    secureContext: window.isSecureContext,
    readyState: video?.readyState,
    videoWidth: video?.videoWidth,
    videoHeight: video?.videoHeight,
    muted: video?.muted,
    autoplay: video?.autoplay,
    playsInline: video?.playsInline,
    trackReadyState: track?.readyState,
    trackSettings: track?.getSettings(),
  }
  void navigator.permissions
    ?.query({ name: 'camera' as PermissionName })
    .then((status) => {
      // eslint-disable-next-line no-console
      console.log(`[selfie-camera] ${label}`, { ...report, permissionState: status.state })
    })
    .catch(() => {
      // Not all browsers support querying the 'camera' permission name — fine to omit.
      // eslint-disable-next-line no-console
      console.log(`[selfie-camera] ${label}`, report)
    })
}

export interface CameraStreamHandle {
  cameraState: CameraState
  videoReady: boolean
  /** Set only when cameraState becomes 'busy' via a play() rejection — the actual DOMException name, safe to show. */
  playErrorName: string | undefined
  /** Stops any existing stream/timers/listeners, then requests a fresh one. */
  retry: () => void
}

/**
 * Owns the getUserMedia lifecycle for the guest selfie camera. The caller must keep
 * its <video> element mounted for the entire lifetime of this hook (never
 * conditionally rendered on cameraState) — that's what makes the "ref not attached
 * yet" race structurally rare, and the extra always-runs effect below covers it even
 * so.
 */
export function useCameraStream(videoRef: React.RefObject<HTMLVideoElement | null>): CameraStreamHandle {
  const [cameraState, setCameraState] = useState<CameraState>('requesting')
  const [videoReady, setVideoReady] = useState(false)
  const [playErrorName, setPlayErrorName] = useState<string | undefined>(undefined)

  const streamRef = useRef<MediaStream | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const removeListenersRef = useRef<() => void>(() => {})
  // Bumped on every start()/retry()/unmount so a stale in-flight getUserMedia/play
  // promise from a previous attempt can recognize it's obsolete and no-op instead of
  // clobbering newer state.
  const attemptIdRef = useRef(0)

  const clearInitTimeout = useCallback(() => {
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }, [])

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
  }, [videoRef])

  const start = useCallback(() => {
    const attemptId = ++attemptIdRef.current
    removeListenersRef.current()
    clearInitTimeout()
    setVideoReady(false)
    setPlayErrorName(undefined)
    setCameraState('requesting')

    if (!window.isSecureContext) {
      setCameraState('insecure')
      return
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraState('unavailable')
      return
    }

    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'user', width: { ideal: 720 } }, audio: false })
      .then(async (stream) => {
        if (attemptId !== attemptIdRef.current) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        setCameraState('initializing')
        logSafeDiagnostics('getUserMedia resolved', videoRef.current, stream)

        const video = videoRef.current
        if (video && video.srcObject !== stream) video.srcObject = stream

        if (video) {
          try {
            await video.play()
          } catch (err) {
            if (attemptId !== attemptIdRef.current) return
            const name = err instanceof DOMException ? err.name : 'UnknownPlayError'
            logSafeDiagnostics(`video.play() rejected (${name})`, video, stream)
            setPlayErrorName(name)
            setCameraState('busy')
            return
          }
        }
        if (attemptId !== attemptIdRef.current) return

        const checkReady = () => {
          if (attemptId !== attemptIdRef.current) return
          const v = videoRef.current
          if (v && isVideoReady(v)) {
            clearInitTimeout()
            setVideoReady(true)
            setCameraState('ready')
            logSafeDiagnostics('video ready', v, streamRef.current)
          }
        }

        if (video) {
          READY_EVENTS.forEach((evt) => video.addEventListener(evt, checkReady))
          removeListenersRef.current = () => READY_EVENTS.forEach((evt) => video.removeEventListener(evt, checkReady))
        }
        // Covers the case where the ready condition was already true before listeners
        // were attached (e.g. a cached/instant frame).
        checkReady()

        timeoutRef.current = setTimeout(() => {
          if (attemptId !== attemptIdRef.current) return
          setCameraState((current) => (current === 'ready' ? current : 'timeout'))
        }, INIT_TIMEOUT_MS)
      })
      .catch((err: unknown) => {
        if (attemptId !== attemptIdRef.current) return
        const name = err instanceof DOMException ? err.name : ''
        if (name === 'NotReadableError' || name === 'TrackStartError') setCameraState('busy')
        else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') setCameraState('unavailable')
        else setCameraState('denied') // NotAllowedError/PermissionDeniedError, and any unrecognized failure
      })
  }, [videoRef, clearInitTimeout])

  const retry = useCallback(() => {
    stopStream()
    start()
  }, [stopStream, start])

  useEffect(() => {
    start()
    return () => {
      attemptIdRef.current += 1 // invalidate any in-flight getUserMedia/play from this attempt
      clearInitTimeout()
      removeListenersRef.current()
      stopStream()
    }
    // Intentionally run once per mount — retry() is the explicit re-trigger path.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Defensive re-attach: if the stream resolved before videoRef.current existed (the
  // race called out in the requirements), this runs after every render — including
  // the render where the <video> element first mounts — and attaches it then. With
  // the <video> element kept unconditionally mounted by the caller this should never
  // actually be needed, but costs nothing to keep as a second layer.
  useEffect(() => {
    const video = videoRef.current
    if (video && streamRef.current && video.srcObject !== streamRef.current) {
      video.srcObject = streamRef.current
    }
  })

  return { cameraState, videoReady, playErrorName, retry }
}
