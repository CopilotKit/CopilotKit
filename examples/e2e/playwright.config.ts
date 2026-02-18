import { defineConfig, devices } from "@playwright/test";
import path from "path";

const EXAMPLE = process.env.EXAMPLE ?? "form-filling";
const PORT = Number(process.env.PORT ?? "3000");

const HYBRID_EXAMPLES = new Set(["travel", "research-canvas"]);
const webServerCommand = HYBRID_EXAMPLES.has(EXAMPLE)
  ? "pnpm dev:ui"
  : "pnpm dev";

const exampleDir = path.resolve(__dirname, "../v1", EXAMPLE);

export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: webServerCommand,
    url: `http://127.0.0.1:${PORT}`,
    cwd: exampleDir,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      ...process.env,
      PORT: String(PORT),
      NEXT_TELEMETRY_DISABLED: "1",
      OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "test",
      NEXT_PUBLIC_CPK_PUBLIC_API_KEY:
        process.env.NEXT_PUBLIC_CPK_PUBLIC_API_KEY ?? "",
      NEXT_PUBLIC_COPILOT_PUBLIC_API_KEY:
        process.env.NEXT_PUBLIC_COPILOT_PUBLIC_API_KEY ?? "",
      LANGSMITH_API_KEY: process.env.LANGSMITH_API_KEY ?? "",
      REMOTE_ACTION_URL:
        process.env.REMOTE_ACTION_URL ?? "http://127.0.0.1:8000/copilotkit",
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  reporter: process.env.CI ? "github" : "list",
  outputDir: "test-results",
});
