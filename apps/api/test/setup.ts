// Force the zero-config ephemeral MongoDB path for the whole test run, regardless of
// what a developer's local .env happens to set — tests must never touch a real
// database. This must run before any other module (in this file or elsewhere) pulls
// in src/env.ts, which parses process.env once at import time.
//
// IMPORTANT: this only works because there is NO static `import` of anything that
// transitively imports src/env.ts anywhere in this file. ES module imports are
// hoisted to the top of the file and evaluated before any other statement, so a
// static import here — even textually below these assignments — would load
// src/env.ts (and thus dotenv, and thus a real .env's DATABASE_URL) before this code
// ever runs, silently defeating the override. This exact mistake happened once
// already (see the belt-and-suspenders VITEST-env-var check in src/db.ts, which is
// the reason a regression here can no longer actually reach a real database — but
// keep this file free of such imports anyway, so NODE_ENV/etc. overrides stay
// reliable too, not just DATABASE_URL).
process.env.DATABASE_URL = ''
process.env.NODE_ENV = 'test'
process.env.FACE_PROVIDER = 'mock'
process.env.STORAGE_PROVIDER = 'local'
process.env.LOCAL_STORAGE_DIR = './test/.storage'

import { afterAll, beforeAll } from 'vitest'

beforeAll(async () => {
  const { connectDatabase } = await import('../src/db.js')
  await connectDatabase()
}, 60000)

afterAll(async () => {
  const { disconnectDatabase } = await import('../src/db.js')
  await disconnectDatabase()
})
