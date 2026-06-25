import { defineConfig, devices } from "@playwright/test";

const appUrl = process.env.APP_URL || "http://localhost:3000";
const agentUrl =
  process.env.AGENT_URL ||
  process.env.LANGGRAPH_API_URL ||
  "http://localhost:8123";

// Use external servers when explicitly requested, or when creds-driven env vars
// indicate an already-running deployment (APP_URL or AGENT_URL/LANGGRAPH_API_URL set).
const useExternalServers =
  process.env.PLAYWRIGHT_USE_EXTERNAL_SERVERS === "true" ||
  Boolean(
    process.env.APP_URL ||
    process.env.AGENT_URL ||
    process.env.LANGGRAPH_API_URL,
  );

export default defineConfig({
  testDir: "./e2e",
  timeout: 300_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ["list"],
    ["html", { open: "never" }],
    ["json", { outputFile: "artifacts/openbox-e2e-results.json" }],
  ],
  use: {
    baseURL: appUrl,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: useExternalServers
    ? undefined
    : [
        {
          command: "cd ../agent && npm run dev",
          url: `${agentUrl.replace(/\/+$/, "")}/ok`,
          reuseExistingServer: true,
          timeout: 180_000,
        },
        {
          command: "npm run dev",
          url: appUrl,
          reuseExistingServer: true,
          timeout: 180_000,
        },
      ],
});
