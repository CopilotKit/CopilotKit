import { defineConfig, devices } from "@playwright/test";
import { buildIntegrationConfig } from "../playwright.base";

const PORT = parseInt(process.env.PORT || "3000", 10);
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

export default defineConfig(
  buildIntegrationConfig({
    devices,
    slug: "built-in-agent",
    baseURL: BASE_URL,
    overrides: {
      timeout: 60_000,
      expect: { timeout: 10_000 },
      fullyParallel: false,
      workers: 1,
      reporter: process.env.CI
        ? "list"
        : [["list"], ["html", { open: "never" }]],
      use: {
        screenshot: "only-on-failure",
      },
      webServer: process.env.SKIP_WEB_SERVER
        ? undefined
        : {
            command: `npm run dev -- --port ${PORT}`,
            url: BASE_URL,
            reuseExistingServer: !process.env.CI,
            timeout: 120_000,
          },
    },
  }),
);
