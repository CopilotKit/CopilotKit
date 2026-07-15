import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/visual",
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3004",
    trace: "retain-on-failure",
  },
});
