import { defineConfig } from "@playwright/test";

// Dedicated config for the OGUI routing test. Isolated ports (dev :3002, aimock
// :7098) and OSS mode (no INTELLIGENCE_* env) so it never collides with the
// Intelligence-mode suite in playwright.config.ts and needs no docker stack.
export default defineConfig({
  testDir: "./e2e",
  testMatch: /ogui-routing\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:3002",
    trace: "on-first-retry",
    // Wide enough that the full suggestion-pill row stays on-screen — the pills
    // overflow a default 1280px viewport, landing off-screen where clicks fail.
    viewport: { width: 1680, height: 900 },
  },
  webServer: [
    {
      command:
        "AIMOCK_FIXTURES=e2e/fixtures/ogui-routing.fixtures.json AIMOCK_PORT=7098 node e2e/aimock-server.mjs",
      url: "http://localhost:7098/health",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: "pnpm dev",
      url: "http://localhost:3002",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        PORT: "3002",
        OPENAI_API_KEY: "test",
        OPENAI_BASE_URL: "http://localhost:7098/v1",
        // OSS mode: deliberately NO INTELLIGENCE_* vars → the runtime uses the
        // InMemoryAgentRunner path (no docker, no gateway).
        NEXT_TELEMETRY_DISABLED: "1",
      },
    },
  ],
});
