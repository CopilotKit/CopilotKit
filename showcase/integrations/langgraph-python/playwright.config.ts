import { defineConfig, devices } from "@playwright/test";
import { buildIntegrationConfig } from "../playwright.base";

export default defineConfig(
  buildIntegrationConfig({
    devices,
    slug: "langgraph-python",
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
              // Default to local aimock (Docker-exposed) when not set.
              // In CI the env is inherited from docker-compose (http://aimock:4010/v1).
              OPENAI_BASE_URL:
                process.env.OPENAI_BASE_URL || "http://localhost:4010/v1",
              OPENAI_API_KEY: process.env.OPENAI_API_KEY || "sk-mock-local-dev",
            },
          },
    },
  }),
);
