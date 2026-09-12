import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    testTimeout: 30000,
    hookTimeout: 120000,
    setupFiles: ['./test/setup.ts'],
    fileParallelism: false, // all tests share one ephemeral MongoDB instance for the whole run
  },
})
