import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

// End-to-end tests drive the real CopilotKit (V2) chat UI against the live Agent
// Spec agent (LangGraph over AG-UI) and Oracle AI Database. Recorded to video.
//
// This agent runs on :8001 so it won't collide with a manual dev agent on :8000
// (the agent defaults to :8000), so we override the frontend's AGENT_URL here.
//
// Prerequisites (reused if already running):
//   1. Oracle AI Database up + `cookbook` user provisioned (repo-root README).
//   2. The concierge agent on :8001 — Playwright starts it if it isn't.

const FRONTEND_PORT = 3200;
const AGENT_PORT = 8001;
const AGENT_URL = `http://127.0.0.1:${AGENT_PORT}/run`;
const agentDir = path.join(__dirname, "..", "agent");

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  // Clear the demo user's memory before the suite so cross-session recall is
  // deterministic (see global-setup.ts).
  globalSetup: "./global-setup.ts",
  // Tests share one server-side memory store (the `demo-user`); run them in order.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // Agent Spec turns (recall + tool calls + LLM) are slow, and the cross-session
  // test runs two of them back to back.
  timeout: 300_000,
  expect: { timeout: 120_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://localhost:${FRONTEND_PORT}`,
    viewport: { width: 1280, height: 720 },
    video: { mode: "on", size: { width: 1280, height: 720 } },
    trace: "retain-on-failure",
    actionTimeout: 30_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: `uv run python -m uvicorn concierge.server:app --host 127.0.0.1 --port ${AGENT_PORT}`,
      cwd: agentDir,
      url: `http://127.0.0.1:${AGENT_PORT}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
    {
      command: `npm run dev -- --port ${FRONTEND_PORT}`,
      url: `http://localhost:${FRONTEND_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: { AGENT_URL },
    },
  ],
});
