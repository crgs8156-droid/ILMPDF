import { defineConfig, devices } from '@playwright/test';

// Tests run against the production build served on loopback only.
const BASE_URL = 'http://127.0.0.1:4173';
// Optional: point at a preinstalled Chromium (used in sandboxed environments).
const chromiumPath = process.env.ILMPDF_CHROMIUM_PATH;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: BASE_URL,
    acceptDownloads: true,
    trace: 'off',
  },
  webServer: {
    command: 'npm run build && npm run preview',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    // WebKit is Safari's engine and the primary target.
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(chromiumPath ? { launchOptions: { executablePath: chromiumPath } } : {}),
      },
    },
  ],
});
