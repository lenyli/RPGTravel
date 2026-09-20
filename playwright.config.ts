import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 2,
  timeout: 45000,
  expect: { timeout: 10000 },
  retries: 0,
  outputDir: 'artifacts/test-results',
  reporter: [
    ['list'],
    ['json', { outputFile: 'artifacts/e2e-results.json' }],
    ['html', { outputFolder: 'artifacts/e2e-report', open: 'never' }],
  ],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
      },
    },
    {
      name: 'webkit',
      use: { ...devices['iPhone 13'], defaultBrowserType: 'webkit' },
    },
  ],
  webServer: [
    {
      command: 'npm run preview -- --port 4173 --strictPort',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'node scripts/acceptance-deploy.mjs',
      url: 'http://127.0.0.1:4174',
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
    },
  ],
});
