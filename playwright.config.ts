import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  workers: 1,
  timeout: 60_000,
  projects: [
    {
      name: 'chromium',
      testIgnore: /safariMobile\.spec\.ts/,
      use: {
        browserName: 'chromium',
        viewport: { width: 1280, height: 720 }
      }
    },
    {
      name: 'mobile-webkit',
      testMatch: /safariMobile\.spec\.ts/,
      use: {
        ...devices['iPhone 13'],
        browserName: 'webkit'
      }
    }
  ]
});
