import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'npm run dev -w @neoteric-memories/api',
      url: 'http://localhost:4000/health',
      cwd: '../..',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: { PORT: '4000' },
    },
    {
      command: 'npm run dev -w @neoteric-memories/web',
      url: 'http://localhost:5173',
      cwd: '../..',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
})
