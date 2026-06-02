import { defineConfig, devices } from "@playwright/test";
import { buildIntegrationConfig } from "../playwright.base";

export default defineConfig(
  buildIntegrationConfig({
    devices,
    slug: "mastra",
    overrides: {
      workers: process.env.CI ? 1 : undefined,
      webServer: process.env.CI
        ? undefined
        : {
            command: "pnpm dev",
            url: "http://localhost:3000",
            reuseExistingServer: true,
            env: {
              ...process.env,
              OPENAI_BASE_URL: process.env.OPENAI_BASE_URL || "",
              OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
            },
          },
    },
  }),
);
