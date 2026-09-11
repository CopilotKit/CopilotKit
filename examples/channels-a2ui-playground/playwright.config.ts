import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

const port = process.env.PLAYGROUND_TEST_PORT
  ? Number(process.env.PLAYGROUND_TEST_PORT)
  : Number(process.env.CONDUCTOR_PORT ?? 4170) + 9;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  use: {
    baseURL,
    browserName: "chromium",
    viewport: { width: 1440, height: 1050 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: `pnpm exec nx run channels-a2ui-playground:preview --port=${port} --strictPort`,
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    url: baseURL,
    reuseExistingServer: false,
    env: { NX_DAEMON: "false", NX_TUI: "false" },
  },
});
