import convert from 'heic-convert'
import { logger } from './logger.js'

/**
 * HEIC is the default photo format on iPhone, and sharp's prebuilt binary (which
 * only bundles AVIF's aom/AV1 codec, not HEIC's licensed HEVC one — see `sharp.format
 * .heif.fileSuffix`, which lists only `.avif`) cannot decode it. heic-convert is a
 * pure-JS/WASM decoder (via heic-decode/libheif-js), so it works the same on any
 * host (including Render) with no native library or licensing dependency.
 *
 * Returns null (does not throw) on a genuinely corrupt/unreadable HEIC file — the
 * caller treats that the same as any other invalid image.
 */
export async function convertHeicToJpeg(buffer: Buffer): Promise<Buffer | null> {
  try {
    return await convert({ buffer, format: 'JPEG', quality: 0.92 })
  } catch (err) {
    logger.warn({}, `HEIC conversion failed: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}
