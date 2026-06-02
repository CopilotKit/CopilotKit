import { defineConfig, devices } from "@playwright/test";
import { buildIntegrationConfig } from "../playwright.base";

// NB: this integration intentionally sets no `X-AIMock-Context` header, so no
// `slug` is passed to the shared base.
export default defineConfig(
  buildIntegrationConfig({
    devices,
    overrides: {
      // Local default of 4 workers caps the SSE concurrency the python agent has
      // to absorb. The reused `agent_framework.Agent` + shared OpenAI HTTP client
      // serialise concurrent streams; >4 workers makes 30s test timeouts inevitable
      // for a few cells. 4 keeps things parallel without overloading the agent.
      workers: process.env.CI ? 1 : 4,
      webServer: process.env.CI
        ? undefined
        : {
            command: "npm run dev",
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
