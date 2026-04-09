import { defineConfig, devices } from "@playwright/test";

/**
 * E2E smoke test config for showcase integrations.
 *
 * By default runs a single "chromium" project with all tests.
 * Use --grep to filter by level: --grep @health, --grep @agent, etc.
 *
 * Usage:
 *   npx playwright test                    # all levels
 *   npx playwright test --grep @health     # health checks only
 *   npx playwright test --grep @agent      # agent endpoint only
 *   npx playwright test --grep @chat       # round-trip chat only
 *   npx playwright test --grep @tools      # tool rendering only
 *   npx playwright test -g "langgraph-python"  # single integration
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: {
    timeout: 30_000,
  },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 1,
  workers: process.env.CI ? 2 : 4,
  reporter: process.env.CI ? "github" : "list",
  outputDir: "test-results",
  use: {
    ...devices["Desktop Chrome"],
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
