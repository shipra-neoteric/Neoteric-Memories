import { env } from '../../env.js'
import { isTestRuntime } from '../../lib/testGuard.js'
import { MockFaceSearchProvider } from './MockFaceSearchProvider.js'
import { RekognitionFaceSearchProvider } from './RekognitionFaceSearchProvider.js'
import type { FaceSearchProvider } from './FaceSearchProvider.js'

let instance: FaceSearchProvider | undefined

export function getFaceSearchProvider(): FaceSearchProvider {
  if (!instance) {
    // env.ts already forces FACE_PROVIDER to 'mock' under the test runtime, so this
    // branch is unreachable in practice during tests — a second, independent layer
    // that fails loudly rather than silently constructing a real Rekognition client
    // if that forcing were ever bypassed.
    if (isTestRuntime() && env.FACE_PROVIDER === 'rekognition') {
      throw new Error('Refusing to select RekognitionFaceSearchProvider under the Vitest test runtime.')
    }
    instance = env.FACE_PROVIDER === 'rekognition' ? new RekognitionFaceSearchProvider() : new MockFaceSearchProvider()
  }
  return instance
}

export type { FaceSearchProvider, DetectedFace, SearchMatch, BoundingBox } from './FaceSearchProvider.js'
