import { defineConfig, devices } from "@playwright/test";
// Loading the helpers checks INTEGRATION against the manifests. When it is
// missing or unknown, the run stops here with a message that lists the slugs.
import { integration } from "./tests/e2e/helpers";

const LOCAL_PORT = 3000;
const LOCAL_URL = `http://localhost:${LOCAL_PORT}`;
const isCI = Boolean(process.env.CI);
// BASE_URL points the suite at a server that is already running, for example
// a container. Without it, the suite uses the local dev server.
const startsDevServer = !process.env.BASE_URL && !isCI;

export default defineConfig({
  testDir: "./tests/e2e",
  // tests/e2e also holds vitest files (*.test.ts). Playwright runs the specs.
  testMatch: "*.spec.ts",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 1 : undefined,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.BASE_URL || LOCAL_URL,
    trace: "on-first-retry",
    // aimock answers with the fixtures of the integration under test.
    extraHTTPHeaders: { "X-AIMock-Context": integration },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // `npm run dev` writes the registry, then starts Next on LOCAL_PORT. A server
  // that already answers there is used as it is. Playwright gives the server
  // this process's environment, so AGENT_URL_* and the other variables reach
  // the app.
  webServer: startsDevServer
    ? {
        command: `npm run dev -- --port ${LOCAL_PORT}`,
        url: LOCAL_URL,
        reuseExistingServer: true,
      }
    : undefined,
});
