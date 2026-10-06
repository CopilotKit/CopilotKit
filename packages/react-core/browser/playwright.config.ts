import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  outputDir: join(tmpdir(), "copilotkit-opengenui-playwright"),
  testMatch: "*.spec.ts",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:15185" },
  webServer: {
    command: "node browser/server.mjs",
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    url: "http://127.0.0.1:15185",
    reuseExistingServer: false,
  },
});
