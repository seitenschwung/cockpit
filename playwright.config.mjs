import { defineConfig } from '@playwright/test';

// Locally: CHROMIUM_PATH=/usr/bin/chromium npm test. In CI the runner's Chrome is used.
export default defineConfig({
  testDir: 'tests',
  reporter: 'dot',
  webServer: {
    command: 'python3 -m http.server 8099 --bind 127.0.0.1 --directory public',
    url: 'http://127.0.0.1:8099/',
    stdout: 'ignore',
    stderr: 'ignore',
    reuseExistingServer: !process.env.CI,
  },
  use: {
    baseURL: 'http://127.0.0.1:8099',
    channel: process.env.CI ? 'chrome' : undefined,
    launchOptions: { executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'] },
  },
});
