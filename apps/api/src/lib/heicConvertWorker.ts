// Runs exactly one HEIC->JPEG conversion, then the parent (heicConvert.ts)
// terminates this worker immediately — never reused for a second file. See
// heicConvert.ts for why: this is what guarantees the WASM decoder's memory (which
// production evidence shows is NOT fully released back to the process between calls
// otherwise — it drove the server over its memory limit and crashed it) is fully
// reclaimed by the OS every single time, regardless of anything the library itself
// leaks internally.
import { parentPort, workerData } from 'node:worker_threads'
import convert from 'heic-convert'

interface WorkerResult {
  ok: boolean
  buffer?: Uint8Array
  error?: string
}

async function run(): Promise<void> {
  try {
    const inputBuffer = Buffer.from(workerData as Uint8Array)
    const converted = await convert({ buffer: inputBuffer, format: 'JPEG', quality: 0.92 })
    const result: WorkerResult = { ok: true, buffer: converted }
    parentPort?.postMessage(result)
  } catch (err) {
    const result: WorkerResult = { ok: false, error: err instanceof Error ? err.message : String(err) }
    parentPort?.postMessage(result)
  }
}

void run()
