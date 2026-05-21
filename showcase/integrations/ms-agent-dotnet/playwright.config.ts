import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // Local default of 1 retry covers the `agent_framework.Agent` concurrency
  // flake: the shared Agent instance + single OpenAI HTTP client serialise
  // SSE streams under high worker counts, so a handful of cells time out at
  // 30s on the first attempt and pass cleanly on retry. CI keeps 2 retries
  // as the safer ratchet. The underlying upstream fix is per-request agent
  // instantiation; see the D5 sweep doc in Notion.
  retries: process.env.CI ? 2 : 1,
  // Local default of 4 workers caps the SSE concurrency the python agent has
  // to absorb. The reused `agent_framework.Agent` + shared OpenAI HTTP client
  // serialise concurrent streams; >4 workers makes 30s test timeouts inevitable
  // for a few cells. 4 keeps things parallel without overloading the agent.
  workers: process.env.CI ? 1 : 4,
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
          OPENAI_BASE_URL: process.env.OPENAI_BASE_URL || "",
          OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
        },
      },
});
