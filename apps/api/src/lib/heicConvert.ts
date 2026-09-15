import { Worker } from 'node:worker_threads'
import { logger } from './logger.js'

// HEIC is the default photo format on iPhone, and sharp's prebuilt binary can't
// decode it (it only bundles AVIF's aom/AV1 codec, not HEIC's licensed HEVC one —
// see sharp.format.heif.fileSuffix, which lists only .avif). heic-convert is a pure-
// JS/WASM decoder, so it works the same on any host (including Render) with no
// native library or licensing dependency — but production evidence showed its WASM
// memory is NOT fully released back to the process between calls when run in-process
// repeatedly, which drove the server over its memory limit and crashed it (twice, in
// one incident, syncing a folder with 291 HEIC files).
//
// Running each conversion in its own worker thread, then terminating that worker
// immediately after, is what actually fixes this: terminating a worker destroys its
// entire V8 isolate (JS heap *and* WASM linear memory), so nothing from one
// conversion can ever accumulate into the next, regardless of what the library
// itself leaks internally. As a side benefit, the (synchronous, CPU-heavy) WASM
// decode now runs on a separate OS thread, so it can no longer block the main
// server's event loop from handling unrelated requests while a conversion is
// running — the other half of what caused the outage.
const WORKER_URL = new URL('./heicConvertWorker.js', import.meta.url)
const CONVERSION_TIMEOUT_MS = 30_000

interface WorkerResult {
  ok: boolean
  buffer?: Uint8Array
  error?: string
}

/** Returns null (does not throw) on a genuinely corrupt/unreadable HEIC file, a crashed worker, or a timeout — the caller treats all of these the same as any other invalid image. */
export async function convertHeicToJpeg(buffer: Buffer): Promise<Buffer | null> {
  return new Promise((resolve) => {
    let settled = false
    const worker = new Worker(WORKER_URL, { workerData: buffer })

    const finish = (result: Buffer | null) => {
      if (settled) return
      settled = true
      clearTimeout(timeoutHandle)
      resolve(result)
      void worker.terminate()
    }

    const timeoutHandle = setTimeout(() => {
      logger.warn({}, 'HEIC conversion timed out after 30s and was aborted')
      finish(null)
    }, CONVERSION_TIMEOUT_MS)

    worker.once('message', (msg: WorkerResult) => {
      if (msg.ok && msg.buffer) {
        finish(Buffer.from(msg.buffer))
      } else {
        logger.warn({}, `HEIC conversion failed: ${msg.error}`)
        finish(null)
      }
    })
    worker.once('error', (err) => {
      logger.warn({}, `HEIC conversion worker crashed: ${err.message}`)
      finish(null)
    })
    worker.once('exit', (code) => {
      // A clean conversion already resolved via the 'message' handler above (which
      // calls finish() and terminates the worker, itself triggering this 'exit' —
      // the `settled` guard makes that a no-op). This branch only fires for a worker
      // that died some other way without ever posting a result.
      if (!settled) {
        logger.warn({}, `HEIC conversion worker exited unexpectedly (code ${code}) without a result`)
        finish(null)
      }
    })
  })
}
