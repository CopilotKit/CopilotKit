import { defineConfig, devices } from "@playwright/test";

/**
 * Visual regression tests for the Angular demo. Each test opens a `/visual/*`
 * route that renders fixed UI states, so no agent or network is involved, and
 * compares it with a committed reference image.
 *
 * Reference images live in `e2e/visual/baselines/`. Only the Linux images are
 * committed (CI runs on Linux; fonts render differently per OS). See
 * `e2e/visual/README.md` to run or update them.
 */
const PORT = 4300;

export default defineConfig({
  testDir: "./e2e/visual",
  snapshotPathTemplate:
    "{testDir}/baselines/{testFileName}/{arg}-{projectName}-{platform}{ext}",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  expect: {
    toHaveScreenshot: { animations: "disabled", caret: "hide" },
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 800 },
      },
    },
  ],
  webServer: {
    command: `pnpm exec ng serve --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
