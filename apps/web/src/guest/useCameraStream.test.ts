import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { INIT_TIMEOUT_MS, useCameraStream } from './useCameraStream'

function createTrack(): MediaStreamTrack {
  return {
    stop: vi.fn(),
    readyState: 'live',
    getSettings: () => ({ width: 720, height: 1280 }),
  } as unknown as MediaStreamTrack
}

function createStream(track: MediaStreamTrack = createTrack()): MediaStream {
  return {
    getTracks: () => [track],
    getVideoTracks: () => [track],
  } as unknown as MediaStream
}

/** A real <video> element (jsdom) with the read-only media properties made
 * writable, and play() mocked since jsdom has no real media pipeline. */
function createVideoElement(): HTMLVideoElement {
  const video = document.createElement('video')
  video.play = vi.fn().mockResolvedValue(undefined)
  setVideoDimensions(video, 0, 0, 0)
  return video
}

function setVideoDimensions(video: HTMLVideoElement, width: number, height: number, readyState: number): void {
  Object.defineProperty(video, 'videoWidth', { value: width, writable: true, configurable: true })
  Object.defineProperty(video, 'videoHeight', { value: height, writable: true, configurable: true })
  Object.defineProperty(video, 'readyState', { value: readyState, writable: true, configurable: true })
}

async function flushMicrotasks(times = 3): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => {
      await Promise.resolve()
    })
  }
}

describe('useCameraStream', () => {
  let getUserMediaMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    getUserMediaMock = vi.fn()
    Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true })
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: getUserMediaMock }, configurable: true })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('attaches the stream once the video ref becomes available after getUserMedia resolves (mount race)', async () => {
    const stream = createStream()
    getUserMediaMock.mockResolvedValue(stream)
    const videoRef: { current: HTMLVideoElement | null } = { current: null }

    renderHook(() => useCameraStream(videoRef))
    await flushMicrotasks()

    // getUserMedia has resolved, but nothing to attach to yet.
    expect(videoRef.current).toBeNull()

    // The <video> element "mounts" — simulate by assigning the ref directly, the way
    // React would once the element (kept always-rendered per the component's own
    // contract) exists in the DOM.
    const video = createVideoElement()
    videoRef.current = video
    const { rerender } = renderHook(() => useCameraStream(videoRef))
    await flushMicrotasks()
    rerender()

    expect(video.srcObject).toBe(stream)
  })

  it('reaches ready when play() resolves and a later canplay event reports real dimensions', async () => {
    const stream = createStream()
    getUserMediaMock.mockResolvedValue(stream)
    const video = createVideoElement()
    const videoRef = { current: video }

    const { result } = renderHook(() => useCameraStream(videoRef))
    await flushMicrotasks()

    // play() resolved, but no frame yet — still not ready.
    expect(result.current.cameraState).toBe('initializing')
    expect(result.current.videoReady).toBe(false)

    // No ready event has fired yet, and dimensions are still zero: still not ready.
    await flushMicrotasks()
    expect(result.current.cameraState).toBe('initializing')

    // Now a real frame arrives and the browser fires canplay.
    act(() => {
      setVideoDimensions(video, 720, 1280, HTMLMediaElement.HAVE_CURRENT_DATA)
      video.dispatchEvent(new Event('canplay'))
    })

    expect(result.current.cameraState).toBe('ready')
    expect(result.current.videoReady).toBe(true)
  })

  it('reaches ready via a resize event even if canplay never fires', async () => {
    const stream = createStream()
    getUserMediaMock.mockResolvedValue(stream)
    const video = createVideoElement()
    const videoRef = { current: video }

    const { result } = renderHook(() => useCameraStream(videoRef))
    await flushMicrotasks()
    expect(result.current.cameraState).toBe('initializing')

    // Some browsers/devices report the frame becoming available via `resize` rather
    // than canplay/loadeddata — the hook must treat every listed event identically.
    act(() => {
      setVideoDimensions(video, 640, 480, HTMLMediaElement.HAVE_CURRENT_DATA)
      video.dispatchEvent(new Event('resize'))
    })

    expect(result.current.cameraState).toBe('ready')
    expect(result.current.videoReady).toBe(true)
  })

  it('never leaves "Starting camera…" (initializing) forever — times out after 10s if no frame ever arrives', async () => {
    vi.useFakeTimers()
    const stream = createStream()
    getUserMediaMock.mockResolvedValue(stream)
    const video = createVideoElement()
    const videoRef = { current: video }

    const { result } = renderHook(() => useCameraStream(videoRef))
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(result.current.cameraState).toBe('initializing')

    // No canplay/loadeddata/resize ever fires — dimensions stay zero.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INIT_TIMEOUT_MS)
    })

    expect(result.current.cameraState).toBe('timeout')
    expect(result.current.videoReady).toBe(false)
  })

  it('retry() after a timeout stops the old stream and successfully reaches ready on the new one', async () => {
    vi.useFakeTimers()
    const oldTrack = createTrack()
    const oldStream = createStream(oldTrack)
    const newStream = createStream()
    getUserMediaMock.mockResolvedValueOnce(oldStream).mockResolvedValueOnce(newStream)
    const video = createVideoElement()
    const videoRef = { current: video }

    const { result } = renderHook(() => useCameraStream(videoRef))
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INIT_TIMEOUT_MS)
    })
    expect(result.current.cameraState).toBe('timeout')
    expect(oldTrack.stop).not.toHaveBeenCalled() // not stopped yet — only retry() tears down the old stream

    act(() => {
      result.current.retry()
    })
    expect(oldTrack.stop).toHaveBeenCalled()

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(result.current.cameraState).toBe('initializing')

    act(() => {
      setVideoDimensions(video, 720, 1280, HTMLMediaElement.HAVE_CURRENT_DATA)
      video.dispatchEvent(new Event('canplay'))
    })
    expect(result.current.cameraState).toBe('ready')
    expect(video.srcObject).toBe(newStream)
  })

  it('reports a safe DOMException name and sets busy when play() rejects', async () => {
    const stream = createStream()
    getUserMediaMock.mockResolvedValue(stream)
    const video = createVideoElement()
    video.play = vi.fn().mockRejectedValue(new DOMException('blocked', 'NotAllowedError'))
    const videoRef = { current: video }

    const { result } = renderHook(() => useCameraStream(videoRef))
    await flushMicrotasks()

    expect(result.current.cameraState).toBe('busy')
    expect(result.current.playErrorName).toBe('NotAllowedError')
  })

  it('reports insecure when window.isSecureContext is false, without ever calling getUserMedia', async () => {
    Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true })
    const videoRef = { current: createVideoElement() }

    const { result } = renderHook(() => useCameraStream(videoRef))
    await flushMicrotasks()

    expect(result.current.cameraState).toBe('insecure')
    expect(getUserMediaMock).not.toHaveBeenCalled()
  })

  it('classifies getUserMedia rejections by DOMException name', async () => {
    const videoRef = { current: createVideoElement() }

    getUserMediaMock.mockRejectedValueOnce(new DOMException('busy', 'NotReadableError'))
    const busy = renderHook(() => useCameraStream(videoRef))
    await flushMicrotasks()
    expect(busy.result.current.cameraState).toBe('busy')

    getUserMediaMock.mockRejectedValueOnce(new DOMException('none', 'NotFoundError'))
    const unavailable = renderHook(() => useCameraStream({ current: createVideoElement() }))
    await flushMicrotasks()
    expect(unavailable.result.current.cameraState).toBe('unavailable')

    getUserMediaMock.mockRejectedValueOnce(new DOMException('no', 'NotAllowedError'))
    const denied = renderHook(() => useCameraStream({ current: createVideoElement() }))
    await flushMicrotasks()
    expect(denied.result.current.cameraState).toBe('denied')
  })

  it('stops media tracks on unmount', async () => {
    const track = createTrack()
    const stream = createStream(track)
    getUserMediaMock.mockResolvedValue(stream)
    const videoRef = { current: createVideoElement() }

    const { unmount } = renderHook(() => useCameraStream(videoRef))
    await flushMicrotasks()

    unmount()
    expect(track.stop).toHaveBeenCalled()
  })
})
