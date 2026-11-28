import { defineConfig, devices } from "@playwright/test";

/**
 * E2E tests for the Project Management Copilot showcase.
 *
 * These run against the deterministic mock stack (no API keys), which you
 * start with `npm run dev:e2e` (aimock + both agents + BFF + Vite, all with
 * USE_MOCK=1). The config reuses an already-running stack when present, so
 * you can also just have `npm run dev` up and point the tests at it.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1, // agents hold shared per-thread state — run serially
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 15_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
