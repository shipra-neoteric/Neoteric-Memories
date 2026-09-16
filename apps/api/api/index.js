// Vercel serverless entry point for the API. Wraps the same Express app used by
// server.ts (see src/app.ts) so route behavior is identical between Render (a
// persistent process, see docs/DEPLOYMENT.md) and Vercel (one function invocation
// per request) — the only difference is who calls app.listen(): server.ts does it
// itself, here Vercel's platform owns the actual socket and just hands us (req, res)
// per request. Deliberately does NOT import jobs/loop.js — the background job
// processor and Drive sync scheduler are expected to keep running on Render; a
// serverless function invocation ends shortly after it responds, so a setInterval-based
// loop started here would not keep running between requests the way it does in a
// long-lived process.
//
// Imports from ../dist (the compiled build), not ../src — Vercel's Node File Trace
// bundler only follows static import/require statements, so this file is plain JS
// (not run through the project's own tsc build) referencing the already-built output
// that this project's buildCommand produces.
import { createApp } from '../dist/app.js'
import { connectDatabase } from '../dist/db.js'

let readyPromise

// connectDatabase() is itself idempotent (returns the cached client on every call
// after the first) but calling it directly from every invocation would still incur an
// unnecessary await; caching the promise once per warm function instance skips that
// on every request after the first on that instance.
function ensureReady() {
  if (!readyPromise) readyPromise = connectDatabase()
  return readyPromise
}

const app = createApp()

export default async function handler(req, res) {
  await ensureReady()
  app(req, res)
}
