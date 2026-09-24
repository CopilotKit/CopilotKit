import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 90_000,
  // Browser tests inspect and mutate one local SQLite file.
  workers: 1,
  use: { baseURL: "http://127.0.0.1:3000", headless: true },
  reporter: "list",
});
