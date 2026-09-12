import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "*.browser.ts",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  outputDir: join(tmpdir(), "copilotkit-web-inspector-playwright"),
  use: {
    baseURL: "http://127.0.0.1:5177",
    screenshot: "off",
    trace: "off",
    video: "off",
  },
  webServer: {
    command:
      "pnpm exec vite dev dev --config dev/vite.config.ts --host 127.0.0.1 --port 5177",
    cwd: "..",
    url: "http://127.0.0.1:5177/",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
