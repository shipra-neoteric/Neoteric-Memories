import sharp from 'sharp'
import { colorDistance, PERSON_MARKERS, type PersonMarker } from './colorMarkers.js'
import type { BoundingBox } from './FaceSearchProvider.js'

const GRID_STEP_PX = 5
const MATCH_TOLERANCE = 26

export interface ScannedMarker {
  marker: PersonMarker
  boundingBox: BoundingBox
  /** 0-100, derived from the detected marker's on-screen size — a stand-in for real detection confidence. */
  confidence: number
  matchedPointCount: number
  /** Average sampled RGB of the region — may differ slightly from `marker.rgb` for a deliberately close-but-not-identical "lookalike" fixture, which is what lets similarity scoring be graded rather than a binary snap. */
  avgColor: [number, number, number]
}

/**
 * Scans a synthetic demo photo for solid-color "face marker" squares, grouping
 * matched pixels per palette identity and returning one bounding box per identity
 * found. This is the entire "computer vision" the mock provider does — see
 * colorMarkers.ts for why this is an intentional, honest stand-in rather than a toy
 * attempt at real face detection.
 */
export async function scanForMarkers(imageBuffer: Buffer): Promise<ScannedMarker[]> {
  const { data, info } = await sharp(imageBuffer).raw().toBuffer({ resolveWithObject: true })
  const { width, height, channels } = info

  const byMarker = new Map<
    string,
    { minX: number; minY: number; maxX: number; maxY: number; count: number; sumR: number; sumG: number; sumB: number }
  >()

  for (let y = 0; y < height; y += GRID_STEP_PX) {
    for (let x = 0; x < width; x += GRID_STEP_PX) {
      const idx = (y * width + x) * channels
      const r = data[idx] ?? 0
      const g = data[idx + 1] ?? 0
      const b = data[idx + 2] ?? 0

      let best: PersonMarker | undefined
      let bestDist = Infinity
      for (const marker of PERSON_MARKERS) {
        const dist = colorDistance([r, g, b], marker.rgb)
        if (dist < bestDist) {
          bestDist = dist
          best = marker
        }
      }
      if (!best || bestDist > MATCH_TOLERANCE) continue

      const bucket = byMarker.get(best.id)
      if (!bucket) {
        byMarker.set(best.id, { minX: x, minY: y, maxX: x, maxY: y, count: 1, sumR: r, sumG: g, sumB: b })
      } else {
        bucket.minX = Math.min(bucket.minX, x)
        bucket.minY = Math.min(bucket.minY, y)
        bucket.maxX = Math.max(bucket.maxX, x)
        bucket.maxY = Math.max(bucket.maxY, y)
        bucket.count += 1
        bucket.sumR += r
        bucket.sumG += g
        bucket.sumB += b
      }
    }
  }

  const results: ScannedMarker[] = []
  for (const [markerId, box] of byMarker.entries()) {
    // A handful of stray tolerance-matched grid points (e.g. anti-aliased edges elsewhere) shouldn't count as a face.
    if (box.count < 4) continue
    const marker = PERSON_MARKERS.find((m) => m.id === markerId)
    if (!marker) continue
    const widthPx = box.maxX - box.minX + GRID_STEP_PX
    const heightPx = box.maxY - box.minY + GRID_STEP_PX
    const sizePx = Math.min(widthPx, heightPx)
    const confidence = Math.max(1, Math.min(99, Math.round(50 + sizePx * 0.55)))

    results.push({
      marker,
      boundingBox: {
        left: box.minX / width,
        top: box.minY / height,
        width: widthPx / width,
        height: heightPx / height,
      },
      confidence,
      matchedPointCount: box.count,
      avgColor: [Math.round(box.sumR / box.count), Math.round(box.sumG / box.count), Math.round(box.sumB / box.count)],
    })
  }
  return results
}
