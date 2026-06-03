import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: { baseURL: "http://localhost:3000", trace: "on-first-retry" },
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      // The runtime route imports BuiltInAgent which requires OPENAI_API_KEY at
      // module load. The smoke test never invokes the agent — it only checks
      // that the page renders and the popup opens — but the dev server needs
      // *some* value here to boot the API route without crashing. Tests must
      // remain LLM-free; we only set this so the Next.js server starts.
      OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "test",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
