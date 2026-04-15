/**
 * Playwright config for showcase E2E tests.
 *
 * These tests run against a locally running dev server (starter or package).
 * Set BASE_URL to point at the right server:
 *
 *   BASE_URL=http://localhost:3000 npx playwright test
 *
 * Without BASE_URL, defaults to http://localhost:3000.
 */

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./__tests__/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  outputDir: "test-results",
  use: {
    baseURL: process.env.BASE_URL || "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
