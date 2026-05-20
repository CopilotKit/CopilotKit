import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: process.env.BASE_URL || "http://localhost:3000",
    trace: "on-first-retry",
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
        command: "pnpm dev",
        url: "http://localhost:3000",
        reuseExistingServer: true,
        env: {
          ...process.env,
          // Default to local aimock (Docker-exposed) when not set.
          // In CI the env is inherited from docker-compose (http://aimock:4010/v1).
          OPENAI_BASE_URL:
            process.env.OPENAI_BASE_URL || "http://localhost:4010/v1",
          OPENAI_API_KEY: process.env.OPENAI_API_KEY || "sk-mock-local-dev",
        },
      },
});
