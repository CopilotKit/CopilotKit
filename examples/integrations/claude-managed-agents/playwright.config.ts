import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  use: { baseURL: "http://127.0.0.1:3319", trace: "retain-on-failure" },
  webServer: {
    command: "npm run dev:mock",
    url: "http://127.0.0.1:3319",
    env: { PORT: "3319", AIMOCK_PORT: "4319" },
    timeout: 120_000,
    reuseExistingServer: false,
  },
});
