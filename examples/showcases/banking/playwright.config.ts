import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testIgnore: /ogui-routing\.spec\.ts/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: { baseURL: "http://localhost:3000", trace: "on-first-retry" },
  // Two servers: aimock (deterministic LLM) must be up before the dev server so the
  // runtime's OPENAI_BASE_URL resolves. The memory-learning E2E additionally needs
  // the docker memory stack already running (see README / e2e/memory-learning.spec).
  webServer: [
    {
      // Deterministic LLM for the memory E2E. See e2e/aimock-server.mjs for the
      // fixture wiring + the CLI fallback if the programmatic API differs.
      command: "node e2e/aimock-server.mjs",
      url: `http://localhost:${process.env.AIMOCK_PORT ?? "7099"}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: "pnpm dev",
      url: "http://localhost:3000",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        // Existing LLM-free smokes only need *some* OPENAI_API_KEY so the route's
        // BuiltInAgent import doesn't crash at boot. The memory E2E additionally
        // points the agent at aimock and runs the runtime in Intelligence mode.
        OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "test",
        OPENAI_BASE_URL:
          process.env.OPENAI_BASE_URL ??
          `http://localhost:${process.env.AIMOCK_PORT ?? "7099"}/v1`,
        INTELLIGENCE_API_URL:
          process.env.INTELLIGENCE_API_URL ?? "http://localhost:7050",
        INTELLIGENCE_GATEWAY_WS_URL:
          process.env.INTELLIGENCE_GATEWAY_WS_URL ?? "ws://localhost:7053",
        INTELLIGENCE_API_KEY:
          process.env.INTELLIGENCE_API_KEY ??
          "cpk_sPRVSEED_seed0privat0longtoken00",
        INTELLIGENCE_USER_ID:
          process.env.INTELLIGENCE_USER_ID ?? "jordan-beamson",
        NEXT_TELEMETRY_DISABLED: "1",
      },
    },
  ],
});
