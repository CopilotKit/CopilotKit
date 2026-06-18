import { defineConfig } from "@playwright/test";

// No `use.video` here: for Electron tests, video recording is configured
// per-launch via `electron.launch({ recordVideo: { dir: "..." } })`, not
// in the project-level config. Setting `use.video` has no effect on the
// Electron launch context and would only cause confusion.
export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.e2e\.ts/,
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? "line" : [["list"], ["html", { open: "never" }]],
});
