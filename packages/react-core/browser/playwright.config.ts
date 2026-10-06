import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  outputDir: join(tmpdir(), "copilotkit-opengenui-playwright"),
  testMatch: "*.spec.ts",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:15185" },
  webServer: {
    command: "node browser/server.mjs",
    cwd: new URL("..", import.meta.url).pathname,
    url: "http://127.0.0.1:15185",
    reuseExistingServer: false,
  },
});
