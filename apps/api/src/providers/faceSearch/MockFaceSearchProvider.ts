import crypto from 'node:crypto'
import { getPrisma } from '../../db.js'
import { toJsonInput } from '../../lib/prismaJson.js'
import { colorDistance, markerById, MAX_COLOR_DISTANCE } from './colorMarkers.js'
import type { DetectedFace, FaceSearchProvider, SearchMatch } from './FaceSearchProvider.js'
import { scanForMarkers } from './imageMarkerScan.js'

/** distance -> similarity slope. Tuned so an exact marker match lands ~99 and a ~35-unit color drift (our "lookalike" test fixtures) lands in the 70s, well under any sane high-confidence threshold. */
const SIMILARITY_SLOPE = 100 / (MAX_COLOR_DISTANCE * 0.33)

function similarityFromColorDistance(distance: number): number {
  return Math.max(0, Math.min(99, Math.round(100 - distance * SIMILARITY_SLOPE)))
}

/**
 * Deterministic, dependency-free mock of a real face-search backend. Does not do any
 * actual computer vision — see colorMarkers.ts for the design rationale. Suitable for
 * local development, demos without AWS credentials, and CI, because results never
 * depend on a third-party AI model's non-determinism.
 *
 * State is persisted in the MockFaceIndexEntry Mongo collection, scoped strictly by
 * eventId on every query — this is the concrete code enforcing "a selfie for Event A
 * can never search Event B" for the mock path (Rekognition enforces the same rule by
 * only ever searching within the event's own named collection).
 */
export class MockFaceSearchProvider implements FaceSearchProvider {
  async createEventCollection(_eventId: string): Promise<void> {
    // No server-side collection object to create for the mock provider — rows are
    // naturally scoped by eventId. Kept as a no-op to preserve interface parity.
  }

  async deleteEventCollection(eventId: string): Promise<void> {
    await getPrisma().mockFaceIndexEntry.deleteMany({ where: { eventId } })
  }

  async detectFaces(imageBuffer: Buffer): Promise<DetectedFace[]> {
    const markers = await scanForMarkers(imageBuffer)
    return markers.map((m) => ({
      providerFaceId: crypto.randomUUID(),
      boundingBox: m.boundingBox,
      confidence: m.confidence,
    }))
  }

  async indexPhotoFaces(params: { eventId: string; photoId: string; imageBuffer: Buffer }): Promise<DetectedFace[]> {
    const markers = await scanForMarkers(params.imageBuffer)
    const created: DetectedFace[] = []
    for (const m of markers) {
      const providerFaceId = crypto.randomUUID()
      await getPrisma().mockFaceIndexEntry.create({
        data: {
          eventId: params.eventId,
          photoId: params.photoId,
          providerFaceId,
          colorId: m.marker.id,
          boundingBox: toJsonInput(m.boundingBox),
          confidence: m.confidence,
        },
      })
      created.push({ providerFaceId, boundingBox: m.boundingBox, confidence: m.confidence })
    }
    return created
  }

  async removePhotoFaces(params: { eventId: string; photoId: string; providerFaceIds: string[] }): Promise<void> {
    await getPrisma().mockFaceIndexEntry.deleteMany({
      where: { eventId: params.eventId, photoId: params.photoId, providerFaceId: { in: params.providerFaceIds } },
    })
  }

  async searchEventBySelfie(params: {
    eventId: string
    selfieBuffer: Buffer
    maxResults: number
    minSimilarity: number
  }): Promise<SearchMatch[]> {
    const selfieMarkers = await scanForMarkers(params.selfieBuffer)
    if (selfieMarkers.length === 0) return []

    // Most prominent face = largest detected region, matching "use the dominant face" behavior of real providers when a selfie is expected to contain one primary subject.
    const primary = selfieMarkers.reduce((a, b) =>
      a.boundingBox.width * a.boundingBox.height >= b.boundingBox.width * b.boundingBox.height ? a : b
    )

    const entries = await getPrisma().mockFaceIndexEntry.findMany({ where: { eventId: params.eventId } })

    const byPhoto = new Map<string, SearchMatch>()
    for (const entry of entries) {
      const distance = colorDistance(primary.avgColor, markerById(entry.colorId).rgb)
      const similarity = similarityFromColorDistance(distance)
      if (similarity < params.minSimilarity) continue
      const existing = byPhoto.get(entry.photoId)
      if (!existing || existing.similarity < similarity) {
        byPhoto.set(entry.photoId, { providerFaceId: entry.providerFaceId, photoId: entry.photoId, similarity })
      }
    }

    return [...byPhoto.values()].sort((a, b) => b.similarity - a.similarity).slice(0, params.maxResults)
  }

  async getProcessingStatus(params: { eventId: string }): Promise<{ indexedFaceCount: number }> {
    const indexedFaceCount = await getPrisma().mockFaceIndexEntry.count({ where: { eventId: params.eventId } })
    return { indexedFaceCount }
  }
}
