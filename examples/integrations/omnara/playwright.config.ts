import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  use: { baseURL: "http://127.0.0.1:3329", trace: "retain-on-failure" },
  webServer: {
    command: "npm run dev:mock",
    url: "http://127.0.0.1:3329",
    env: { PORT: "3329", AIMOCK_PORT: "4329" },
    timeout: 120_000,
    reuseExistingServer: false,
  },
});
