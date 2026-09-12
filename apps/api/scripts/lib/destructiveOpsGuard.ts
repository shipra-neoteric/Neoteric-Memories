import { isTestRuntime } from '../../src/lib/testGuard.js'

export const DESTRUCTIVE_CONFIRM_ENV_VAR = 'DESTRUCTIVE_CLOUD_CLEANUP_CONFIRM'
export const DESTRUCTIVE_CONFIRM_VALUE = 'yes-delete-real-cloud-and-database-data'

export interface DestructiveOpsDecision {
  dryRun: boolean
}

/**
 * Pure decision logic, deliberately with no test-runtime check of its own — kept
 * separate from resolveDestructiveOpsMode() below so it can be unit-tested directly
 * without the unconditional Vitest refusal always firing first. Never call this
 * directly from a real cleanup script; call resolveDestructiveOpsMode() instead.
 */
export function evaluateDestructiveOpsConfirmation(argv: string[], envVars: NodeJS.ProcessEnv): DestructiveOpsDecision {
  const executeFlag = argv.includes('--execute')
  const confirmed = envVars[DESTRUCTIVE_CONFIRM_ENV_VAR] === DESTRUCTIVE_CONFIRM_VALUE
  if (executeFlag !== confirmed) {
    throw new Error(
      executeFlag
        ? `--execute was passed but ${DESTRUCTIVE_CONFIRM_ENV_VAR} is not set to the exact required value ("${DESTRUCTIVE_CONFIRM_VALUE}"). Refusing to delete anything.`
        : `${DESTRUCTIVE_CONFIRM_ENV_VAR} is set but --execute was not passed. Refusing to delete anything.`
    )
  }
  return { dryRun: !executeFlag }
}

/**
 * Every destructive cloud/database cleanup utility in this repo MUST call this first,
 * before touching S3, Rekognition, or the database. Default is dry-run: deletion only
 * happens when BOTH `--execute` is passed on the command line AND the environment
 * variable DESTRUCTIVE_CLOUD_CLEANUP_CONFIRM is set to the exact narrow phrase above —
 * a generic "confirm=true" or CI "run everything" flag can never satisfy this by
 * accident. Unconditionally refuses to run at all under the Vitest test runtime,
 * regardless of any flag or env var, so no test can ever reach the deletion path.
 */
export function resolveDestructiveOpsMode(argv: string[]): DestructiveOpsDecision {
  if (isTestRuntime()) {
    throw new Error('Refusing to run any destructive cloud/database cleanup utility under the Vitest test runtime.')
  }
  return evaluateDestructiveOpsConfirmation(argv, process.env)
}
