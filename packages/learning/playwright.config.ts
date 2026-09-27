import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./browser-tests",
  fullyParallel: false,
  workers: 1,
  use: { browserName: "chromium", headless: true },
  projects: [
    { name: "capture", grepInvert: /page metadata/ },
    {
      name: "page-metadata",
      grep: /page metadata/,
      use: {
        video: { mode: "on", size: { width: 1280, height: 720 } },
        trace: "on",
      },
    },
  ],
});
