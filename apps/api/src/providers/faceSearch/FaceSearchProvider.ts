export interface BoundingBox {
  left: number
  top: number
  width: number
  height: number
}

export interface DetectedFace {
  providerFaceId: string
  boundingBox: BoundingBox
  /** 0-100 face *detection* confidence (is this a face at all, how clear is it) — distinct from match similarity. */
  confidence: number
}

export interface SearchMatch {
  providerFaceId: string
  photoId: string
  /** 0-100 similarity score between the selfie face and this indexed face. */
  similarity: number
}

/**
 * Every method is event-scoped by design — there is no "search all events" or
 * "search all photos" method on this interface. That is the enforcement point for
 * the event-isolation rule: a selfie submitted for Event A can structurally never
 * search Event B, because the provider never accepts a call without an eventId,
 * and each event gets its own collection (`neoteric-event-{eventId}`).
 */
export interface FaceSearchProvider {
  createEventCollection(eventId: string): Promise<void>
  deleteEventCollection(eventId: string): Promise<void>

  /** Pure detection, no indexing side effect. Used to validate selfies (exactly one face, etc) before searching. */
  detectFaces(imageBuffer: Buffer): Promise<DetectedFace[]>

  /** Detects and indexes every usable face in a photo against the event's collection. */
  indexPhotoFaces(params: { eventId: string; photoId: string; imageBuffer: Buffer }): Promise<DetectedFace[]>

  removePhotoFaces(params: { eventId: string; photoId: string; providerFaceIds: string[] }): Promise<void>

  searchEventBySelfie(params: {
    eventId: string
    selfieBuffer: Buffer
    maxResults: number
    minSimilarity: number
  }): Promise<SearchMatch[]>

  getProcessingStatus(params: { eventId: string }): Promise<{ indexedFaceCount: number }>
}
