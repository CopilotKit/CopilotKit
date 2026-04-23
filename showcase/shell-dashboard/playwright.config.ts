import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for visual regression of the shell-dashboard matrix
 * at 3 viewports: iPhone SE (375×667), iPhone 14 Pro Max (430×932),
 * Desktop (1440×900). Snapshots live in tests/visual/__snapshots__/.
 *
 * The dev server is NOT auto-started; contributors start it manually via
 * `npm run dev` before `npm run test:visual`. This avoids flakiness in
 * CI where the predev prober might hit external URLs.
 */
export default defineConfig({
  testDir: "./tests/visual",
  snapshotPathTemplate:
    "{testDir}/__snapshots__/{testFileName}/{arg}-{projectName}{ext}",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // CI: tolerate transient flakes (snapshot diff on first render, network
  // jitter to PocketBase) by retrying twice. Local: fail fast to surface
  // issues during dev.
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.DASHBOARD_URL ?? "http://localhost:3002",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "iphone-se",
      use: { ...devices["iPhone SE"], viewport: { width: 375, height: 667 } },
    },
    {
      name: "iphone-14-pro-max",
      use: {
        ...devices["iPhone 14 Pro Max"],
        viewport: { width: 430, height: 932 },
      },
    },
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
});
