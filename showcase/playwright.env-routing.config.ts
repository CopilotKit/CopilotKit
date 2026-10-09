import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for the env-routing test (B14).
 *
 * Scoped narrowly to `tests/env-routing.spec.ts` so it doesn't pull in
 * the integrations smoke harness (`tests/playwright.config.ts` →
 * `testDir: ./e2e`) or the shell-dashboard visual regression suite
 * (`shell-dashboard/playwright.config.ts` → `testDir: ./tests/visual`).
 *
 * Runs against LIVE deployments (staging + prod). No webServer block:
 * the test fetches public URLs; nothing local needs to be brought up.
 *
 * Usage:
 *   npx playwright test --config=showcase/playwright.env-routing.config.ts
 *
 * In CI this is gated to run after the B15 Railway env-var wiring
 * deploys settle.
 */
export default defineConfig({
  testDir: "./tests",
  testMatch: /env-routing\.spec\.ts$/,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // Live-net tests can flake on transient TLS / DNS hiccups; one
  // retry mirrors the integrations smoke config and avoids paging
  // ops for a single jittered fetch.
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 4,
  reporter: process.env.CI ? "github" : "list",
  use: {
    ...devices["Desktop Chrome"],
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
