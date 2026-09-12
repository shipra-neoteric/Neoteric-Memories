import { assertNotTestRuntime } from '../../lib/testGuard.js'

export interface LivenessResult {
  isLive: boolean
  score: number
}

/**
 * Optional liveness-detection abstraction (guards against a printed photo or a photo
 * of a screen being used as the "selfie"). Not required for L1's core flow, but the
 * interface exists so it can be turned on later without route changes.
 */
export interface LivenessProvider {
  checkLiveness(imageBuffer: Buffer): Promise<LivenessResult>
}

/** Always reports live in mock mode — matches "include a mock implementation for local dev" from the spec. Never treat this as a real anti-spoofing control. */
export class MockLivenessProvider implements LivenessProvider {
  async checkLiveness(): Promise<LivenessResult> {
    return { isLive: true, score: 100 }
  }
}

/** Wire up Rekognition Face Liveness (a session-based, client-SDK-driven flow) here when LIVENESS_PROVIDER=aws. Left unimplemented — it requires a purpose-built client SDK integration beyond a single server call, out of scope for L1. */
export class UnconfiguredAwsLivenessProvider implements LivenessProvider {
  constructor() {
    assertNotTestRuntime('UnconfiguredAwsLivenessProvider')
  }

  async checkLiveness(): Promise<LivenessResult> {
    throw new Error('LIVENESS_PROVIDER=aws is not implemented in L1 — see docs/AWS_DEPLOYMENT.md.')
  }
}
