import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { normalizeForFaceProvider } from '../../src/lib/imageResize.js'

const REKOGNITION_MAX_BYTES = 5 * 1024 * 1024

describe('normalizeForFaceProvider', () => {
  it('returns a small image completely unchanged, byte-for-byte', async () => {
    // Not just "still small" — re-encoding an image that's already well under the
    // limit is pure downside (it's what broke the mock provider's exact-color
    // matching the first time this was implemented), so this must be a true no-op.
    const small = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#888' } }).jpeg().toBuffer()
    const result = await normalizeForFaceProvider(small)
    expect(result).toBe(small)
  })

  it('shrinks a large, high-detail image to safely under the 5MB Rekognition limit', async () => {
    // Random noise compresses poorly, so a large noisy image reliably produces a
    // multi-megabyte JPEG at full size/quality — a good stand-in for a real,
    // detailed phone photo that would otherwise exceed the API limit.
    const width = 4000
    const height = 3000
    const noise = Buffer.alloc(width * height * 3)
    for (let i = 0; i < noise.length; i++) noise[i] = Math.floor(Math.random() * 256)
    const large = await sharp(noise, { raw: { width, height, channels: 3 } }).jpeg({ quality: 100 }).toBuffer()
    expect(large.length).toBeGreaterThan(REKOGNITION_MAX_BYTES) // sanity check the fixture is actually large

    const result = await normalizeForFaceProvider(large)
    expect(result.length).toBeLessThan(REKOGNITION_MAX_BYTES)

    // Still a valid, decodable image afterwards.
    const meta = await sharp(result).metadata()
    expect(meta.width).toBeGreaterThan(0)
  })
})
