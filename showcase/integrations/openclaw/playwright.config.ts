import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: process.env.BASE_URL || "http://localhost:3119",
    trace: "on-first-retry",
    extraHTTPHeaders: {
      "X-AIMock-Context": "openclaw",
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: process.env.CI
    ? undefined
    : {
        command: "npm run dev",
        url: "http://localhost:3119",
        reuseExistingServer: true,
        env: {
          ...process.env,
          OPENAI_BASE_URL: process.env.OPENAI_BASE_URL || "",
          OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
        },
      },
});
