import {
  CreateCollectionCommand,
  DeleteCollectionCommand,
  DeleteFacesCommand,
  DescribeCollectionCommand,
  DetectFacesCommand,
  IndexFacesCommand,
  ResourceAlreadyExistsException,
  ResourceNotFoundException,
  RekognitionClient,
  SearchFacesByImageCommand,
} from '@aws-sdk/client-rekognition'
import { env } from '../../env.js'
import { assertNotTestRuntime } from '../../lib/testGuard.js'
import type { DetectedFace, FaceSearchProvider, SearchMatch } from './FaceSearchProvider.js'

export function eventCollectionId(eventId: string): string {
  return `neoteric-event-${eventId}`
}

/**
 * Production adapter backed by Amazon Rekognition. NOT exercised against live AWS in
 * this repo's automated tests (per the "never call real cloud AI in CI" requirement)
 * — only manually verifiable once real AWS credentials are configured. See
 * docs/FACE_PROVIDER.md and docs/AWS_DEPLOYMENT.md before relying on this in
 * production: the similarity threshold below is a starting point, not a calibrated
 * value for Neoteric's actual event photography.
 */
export class RekognitionFaceSearchProvider implements FaceSearchProvider {
  private client: RekognitionClient

  constructor() {
    assertNotTestRuntime('RekognitionFaceSearchProvider')
    if (!env.AWS_REGION) throw new Error('AWS_REGION must be set when FACE_PROVIDER=rekognition')
    this.client = new RekognitionClient({
      region: env.AWS_REGION,
      credentials:
        env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY
          ? { accessKeyId: env.AWS_ACCESS_KEY_ID, secretAccessKey: env.AWS_SECRET_ACCESS_KEY }
          : undefined,
    })
  }

  async createEventCollection(eventId: string): Promise<void> {
    try {
      await this.client.send(new CreateCollectionCommand({ CollectionId: eventCollectionId(eventId) }))
    } catch (err) {
      if (err instanceof ResourceAlreadyExistsException) return // idempotent
      throw err
    }
  }

  async deleteEventCollection(eventId: string): Promise<void> {
    try {
      await this.client.send(new DeleteCollectionCommand({ CollectionId: eventCollectionId(eventId) }))
    } catch (err) {
      if (err instanceof ResourceNotFoundException) return // already gone — idempotent
      throw err
    }
  }

  async detectFaces(imageBuffer: Buffer): Promise<DetectedFace[]> {
    const res = await this.client.send(new DetectFacesCommand({ Image: { Bytes: imageBuffer } }))
    return (res.FaceDetails ?? []).map((f, i) => ({
      providerFaceId: `detect-${i}`,
      boundingBox: {
        left: f.BoundingBox?.Left ?? 0,
        top: f.BoundingBox?.Top ?? 0,
        width: f.BoundingBox?.Width ?? 0,
        height: f.BoundingBox?.Height ?? 0,
      },
      confidence: f.Confidence ?? 0,
    }))
  }

  async indexPhotoFaces(params: { eventId: string; photoId: string; imageBuffer: Buffer }): Promise<DetectedFace[]> {
    const res = await this.client.send(
      new IndexFacesCommand({
        CollectionId: eventCollectionId(params.eventId),
        Image: { Bytes: params.imageBuffer },
        ExternalImageId: params.photoId,
        DetectionAttributes: [],
        QualityFilter: 'AUTO',
        MaxFaces: 50,
      })
    )
    return (res.FaceRecords ?? [])
      .filter((r) => r.Face?.FaceId)
      .map((r) => ({
        providerFaceId: r.Face!.FaceId!,
        boundingBox: {
          left: r.Face?.BoundingBox?.Left ?? 0,
          top: r.Face?.BoundingBox?.Top ?? 0,
          width: r.Face?.BoundingBox?.Width ?? 0,
          height: r.Face?.BoundingBox?.Height ?? 0,
        },
        confidence: r.Face?.Confidence ?? 0,
      }))
  }

  async removePhotoFaces(params: { eventId: string; photoId: string; providerFaceIds: string[] }): Promise<void> {
    if (params.providerFaceIds.length === 0) return
    await this.client.send(
      new DeleteFacesCommand({ CollectionId: eventCollectionId(params.eventId), FaceIds: params.providerFaceIds })
    )
  }

  async searchEventBySelfie(params: {
    eventId: string
    selfieBuffer: Buffer
    maxResults: number
    minSimilarity: number
  }): Promise<SearchMatch[]> {
    const res = await this.client.send(
      new SearchFacesByImageCommand({
        CollectionId: eventCollectionId(params.eventId),
        Image: { Bytes: params.selfieBuffer },
        MaxFaces: params.maxResults,
        FaceMatchThreshold: params.minSimilarity,
      })
    )
    const byPhoto = new Map<string, SearchMatch>()
    for (const m of res.FaceMatches ?? []) {
      const photoId = m.Face?.ExternalImageId
      const faceId = m.Face?.FaceId
      const similarity = m.Similarity ?? 0
      if (!photoId || !faceId) continue
      const existing = byPhoto.get(photoId)
      if (!existing || existing.similarity < similarity) {
        byPhoto.set(photoId, { providerFaceId: faceId, photoId, similarity })
      }
    }
    return [...byPhoto.values()].sort((a, b) => b.similarity - a.similarity)
  }

  async getProcessingStatus(params: { eventId: string }): Promise<{ indexedFaceCount: number }> {
    const res = await this.client.send(
      new DescribeCollectionCommand({ CollectionId: eventCollectionId(params.eventId) })
    )
    return { indexedFaceCount: res.FaceCount ?? 0 }
  }
}
