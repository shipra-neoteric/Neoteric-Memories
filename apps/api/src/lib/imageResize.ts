import sharp from 'sharp'

// Amazon Rekognition's DetectFaces/IndexFaces/SearchFacesByImage APIs hard-cap
// inline image bytes at 5,242,880 (5MB) — a real phone photo or a high-res event
// photo routinely exceeds that. Bounding boxes Rekognition returns are fractional
// (0-1 relative to image dimensions), so downscaling before detection/indexing does
// not affect accuracy or break stored coordinates.
const MAX_BYTES = 4.5 * 1024 * 1024 // safety margin under the hard 5MB limit
const INITIAL_MAX_DIMENSION = 1920

/**
 * Re-encodes an image so it's safely under cloud face-provider size limits,
 * shrinking further if needed. Returns the ORIGINAL buffer untouched when it's
 * already comfortably under the limit — re-compressing an already-small image adds
 * nothing for a real provider, and for the deterministic mock provider (exact pixel
 * color matching) an unnecessary extra JPEG re-encode pass can introduce just enough
 * compression noise to shift a marker color outside its matching tolerance.
 */
export async function normalizeForFaceProvider(buffer: Buffer): Promise<Buffer> {
  if (buffer.length <= MAX_BYTES) return buffer

  let quality = 85
  let width = INITIAL_MAX_DIMENSION

  for (let attempt = 0; attempt < 5; attempt++) {
    const resized = await sharp(buffer).rotate().resize({ width, withoutEnlargement: true }).jpeg({ quality }).toBuffer()
    if (resized.length <= MAX_BYTES) return resized
    quality = Math.max(40, quality - 15)
    width = Math.round(width * 0.75)
  }

  // Last-resort pass — by this point the image is already tiny; whatever comes out
  // here is essentially guaranteed to be under the limit.
  return sharp(buffer).rotate().resize({ width: 640, withoutEnlargement: true }).jpeg({ quality: 40 }).toBuffer()
}
