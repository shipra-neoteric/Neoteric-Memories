/**
 * Single source of truth for "are we running under the automated test suite".
 * `VITEST`/`VITEST_WORKER_ID` are set by Vitest itself before any of this repo's
 * code runs, so — unlike `env.NODE_ENV` or any value parsed out of `.env` — this
 * can't be silently defeated by import-ordering mistakes (see the incident this
 * file exists because of: a `.env`-sourced DATABASE_URL leaked into a real test
 * run because a *different* override relied on statement order in an ES module,
 * which is not guaranteed — imports are hoisted). Every place in this codebase
 * that could reach a real external provider (S3, Rekognition, Google OAuth, a real
 * MongoDB) must gate on this, not on env vars.
 */
export function isTestRuntime(): boolean {
  return process.env.VITEST === 'true' || !!process.env.VITEST_WORKER_ID
}

/**
 * Call this as the first line of any constructor/function that would otherwise
 * talk to a real external service. Throws unconditionally under the test runtime,
 * regardless of what any env var says — this is the last line of defense, meant to
 * fire only if something upstream (env var forcing, a factory-level check) already
 * failed to prevent reaching this point.
 */
export function assertNotTestRuntime(providerName: string): void {
  if (isTestRuntime()) {
    throw new Error(
      `Refusing to construct a real ${providerName} under the Vitest test runtime. This must never happen — tests must only ever use mock/local providers. If you're seeing this in a test failure, something upstream failed to force the mock/local provider; do not silence this error, fix the forcing logic instead.`
    )
  }
}
