import { defineConfig, devices } from '@playwright/test';

const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: 1,
  reporter: [['html'], ['list']],
  timeout: 120_000,
  expect: { timeout: 60_000 },

  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'mock',
      testMatch: /^(?!.*live).*\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'live',
      testMatch: /.*live.*\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // In CI, auto-start servers. Locally, start them yourself (npm run dev).
  ...(isCI
    ? {
        webServer: [
          {
            command: 'npm run dev:backend',
            url: 'http://localhost:3001/',
            timeout: 30_000,
          },
          {
            command: 'npm run dev:frontend',
            url: 'http://localhost:3000',
            timeout: 30_000,
          },
        ],
      }
    : {}),
});
