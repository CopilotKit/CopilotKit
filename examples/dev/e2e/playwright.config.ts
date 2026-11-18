import { defineConfig, devices } from "@playwright/test";
import path from "path";

const EXAMPLE = process.env.EXAMPLE ?? "react-demo";
const PORT = Number(process.env.PORT ?? "3000");

const EXAMPLE_PATHS: Record<string, string> = {
  "react-demo": "../by-frontend/react/demo",
};

const examplePath = EXAMPLE_PATHS[EXAMPLE];

if (!examplePath) {
  throw new Error(
    `Unknown EXAMPLE=${EXAMPLE}. Expected one of: ${Object.keys(EXAMPLE_PATHS).join(", ")}`,
  );
}

const exampleDir = path.resolve(__dirname, examplePath);

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
    command: "pnpm dev",
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
