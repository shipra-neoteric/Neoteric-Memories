import { describe, expect, it } from 'vitest'
import {
  DESTRUCTIVE_CONFIRM_ENV_VAR,
  DESTRUCTIVE_CONFIRM_VALUE,
  evaluateDestructiveOpsConfirmation,
  resolveDestructiveOpsMode,
} from '../../scripts/lib/destructiveOpsGuard.js'

describe('destructive cloud/database cleanup guard', () => {
  it('defaults to dry-run when neither --execute nor the confirm env var is present', () => {
    expect(evaluateDestructiveOpsConfirmation([], {})).toEqual({ dryRun: true })
  })

  it('refuses --execute without the exact confirm env var', () => {
    expect(() => evaluateDestructiveOpsConfirmation(['--execute'], {})).toThrow()
    expect(() => evaluateDestructiveOpsConfirmation(['--execute'], { [DESTRUCTIVE_CONFIRM_ENV_VAR]: 'true' })).toThrow()
    expect(() => evaluateDestructiveOpsConfirmation(['--execute'], { [DESTRUCTIVE_CONFIRM_ENV_VAR]: 'yes' })).toThrow()
  })

  it('refuses the confirm env var without --execute', () => {
    expect(() => evaluateDestructiveOpsConfirmation([], { [DESTRUCTIVE_CONFIRM_ENV_VAR]: DESTRUCTIVE_CONFIRM_VALUE })).toThrow()
  })

  it('only enters execute mode when BOTH --execute and the exact confirm value are present', () => {
    expect(evaluateDestructiveOpsConfirmation(['--execute'], { [DESTRUCTIVE_CONFIRM_ENV_VAR]: DESTRUCTIVE_CONFIRM_VALUE })).toEqual({
      dryRun: false,
    })
  })

  it('resolveDestructiveOpsMode unconditionally refuses to run under the Vitest test runtime, regardless of flags', () => {
    expect(() => resolveDestructiveOpsMode(['--execute'])).toThrow(/test runtime/)
    expect(() =>
      resolveDestructiveOpsMode([])
    ).toThrow(/test runtime/)
  })
})
