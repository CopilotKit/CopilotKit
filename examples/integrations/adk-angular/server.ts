import "dotenv/config";
import { createServer } from "node:http";
import {
  CopilotRuntime,
  CopilotKitIntelligence,
  InMemoryAgentRunner,
} from "@copilotkit/runtime/v2";
import { createCopilotNodeListener } from "@copilotkit/runtime/v2/node";
import { HttpAgent } from "@ag-ui/client";

const runtime = new CopilotRuntime({
  agents: {
    default: new HttpAgent({
      url: process.env.AGENT_URL || "http://localhost:8000/",
    }),
  },
  // --- copilotkit:intelligence (remove this block to opt out) ---
  ...(process.env.COPILOTKIT_LICENSE_TOKEN
    ? {
        intelligence: new CopilotKitIntelligence({
          apiKey: process.env.INTELLIGENCE_API_KEY ?? "",
          apiUrl: process.env.INTELLIGENCE_API_URL ?? "http://localhost:4201",
          wsUrl:
            process.env.INTELLIGENCE_GATEWAY_WS_URL ?? "ws://localhost:4401",
        }),
        // Demo stub — replace with your real auth-derived user identity before any
        // multi-user deployment, or all users share one thread history.
        identifyUser: () => ({ id: "demo-user", name: "Demo User" }),
        licenseToken: process.env.COPILOTKIT_LICENSE_TOKEN,
      }
    : { runner: new InMemoryAgentRunner() }),
  // --- /copilotkit:intelligence ---
});

// Use a dedicated RUNTIME_PORT rather than PORT: this process and the Python
// ADK agent are launched together and both load the same root `.env`, and the
// agent reads `PORT` (default 8000). Sharing `PORT` would bind both to one port.
const port = Number(process.env.RUNTIME_PORT ?? 8200);

createServer(
  createCopilotNodeListener({
    runtime,
    basePath: "/api/copilotkit",
    cors: true,
  }),
).listen(port, () => {
  console.log(
    `Copilot Runtime listening at http://localhost:${port}/api/copilotkit`,
  );
});
