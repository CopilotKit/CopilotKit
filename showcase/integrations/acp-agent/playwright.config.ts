import { defineConfig, devices } from "@playwright/test";

const port = Number.parseInt(process.env.PORT || "3000", 10);
const baseUrl = process.env.BASE_URL || `http://localhost:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? "list" : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: baseUrl,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    extraHTTPHeaders: {
      "X-AIMock-Context": "acp-agent",
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.SKIP_WEB_SERVER
    ? undefined
    : {
        command: `npm run dev -- --port ${port}`,
        url: baseUrl,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
