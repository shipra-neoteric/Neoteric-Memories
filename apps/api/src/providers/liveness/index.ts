import { env } from '../../env.js'
import { isTestRuntime } from '../../lib/testGuard.js'
import { MockLivenessProvider, UnconfiguredAwsLivenessProvider, type LivenessProvider } from './LivenessProvider.js'

export function getLivenessProvider(): LivenessProvider {
  // env.ts already forces LIVENESS_PROVIDER to 'mock' under the test runtime — this
  // is a second, independent layer that fails loudly rather than silently constructing
  // the AWS-backed provider if that forcing were ever bypassed.
  if (isTestRuntime() && env.LIVENESS_PROVIDER === 'aws') {
    throw new Error('Refusing to select UnconfiguredAwsLivenessProvider under the Vitest test runtime.')
  }
  return env.LIVENESS_PROVIDER === 'aws' ? new UnconfiguredAwsLivenessProvider() : new MockLivenessProvider()
}
