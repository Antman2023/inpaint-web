const { defineConfig } = require('@playwright/test')

const browserName = process.env.PLAYWRIGHT_BROWSER || 'chromium'

module.exports = defineConfig({
  testDir: './tests/browser-ci',
  workers: 1,
  timeout: 60_000,
  forbidOnly: !!process.env.CI,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4179',
    browserName,
    channel:
      browserName === 'chromium'
        ? process.env.PLAYWRIGHT_CHANNEL || undefined
        : undefined,
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command:
      'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4179 --strictPort',
    url: 'http://127.0.0.1:4179',
    timeout: 30_000,
    reuseExistingServer: false,
  },
})
