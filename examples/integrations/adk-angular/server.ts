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
  ...(process.env.CPK_INTELLIGENCE_API_KEY
    ? {
        intelligence: new CopilotKitIntelligence({
          apiKey: process.env.CPK_INTELLIGENCE_API_KEY,
          ...(process.env.INTELLIGENCE_API_URL
            ? { apiUrl: process.env.INTELLIGENCE_API_URL }
            : {}),
          ...(process.env.INTELLIGENCE_GATEWAY_WS_URL
            ? { wsUrl: process.env.INTELLIGENCE_GATEWAY_WS_URL }
            : {}),
        }),
        // Demo stub — replace with your real auth-derived user identity before any
        // multi-user deployment, or all users share one thread history. The id
        // must correspond to a user that exists in CopilotKit Intelligence;
        // an unknown id (like this literal) can make thread operations fail.
        identifyUser: () => ({ id: "demo-user", name: "Demo User" }),
      }
    : { runner: new InMemoryAgentRunner() }),
  // --- /copilotkit:intelligence ---
});

// Fixed to 8200 to match the hardcoded runtimeUrl in app.config.ts. We do NOT
// read process.env.PORT here: the Python ADK agent (launched from the same
// `npm run dev` and sharing this `.env`) reads PORT (default 8000), so binding
// the runtime to PORT too would collide the two processes on one port.
const port = 8200;

// This runtime is unauthenticated, and `cors: true` below accepts any origin.
// With no host argument Node binds every interface, so a fresh clone served it
// to the whole local network while this banner said "localhost". Bind loopback
// by default; RUNTIME_HOST is the deliberate opt-out (another device, or a
// container). The banner interpolates the same value, so the printed address
// follows the bound address instead of being a fixed string.
const host = process.env.RUNTIME_HOST ?? "127.0.0.1";

createServer(
  createCopilotNodeListener({
    runtime,
    basePath: "/api/copilotkit",
    cors: true,
  }),
).listen(port, host, () => {
  console.log(
    `Copilot Runtime listening at http://${host}:${port}/api/copilotkit`,
  );
});
