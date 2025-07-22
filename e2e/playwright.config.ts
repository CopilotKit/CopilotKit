import { defineConfig, devices } from "@playwright/test";

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  timeout: 120000,
  testDir: "./tests",
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 1,
  /* Opt out of parallel tests on non-CI environments. */
  workers: process.env.CI ? 2 : "50%",

  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: [
    ["github"], // 🎯 GitHub Actions integration
    ["html", { open: "never" }], // For artifacts
    ["json", { outputFile: "test-results/test-results.json" }],
  ],

  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: "retain-on-failure",
    /* Record video for failed tests */
    video: {
      mode: "retain-on-failure",
      size: { width: 1280, height: 720 },
    },
    /* Screenshot on failure */
    screenshot: {
      mode: "only-on-failure",
      fullPage: true,
    },
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
