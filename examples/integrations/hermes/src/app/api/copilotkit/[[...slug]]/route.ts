import {
  CopilotRuntime,
  CopilotKitIntelligence,
  createCopilotEndpoint,
  InMemoryAgentRunner,
} from "@copilotkit/runtime/v2";
import { HermesAgent } from "@ag-ui/hermes";
import { handle } from "hono/vercel";

// Connect-only Hermes example.
//
// The Hermes agent runs wherever YOU start `hermes-agui` — on your machine or a
// remote host. There is no bundled agent here. The browser's connect screen
// (see components/hermes-connection.tsx) sends the chosen server URL as the
// `X-Hermes-Url` header, and the AgentsFactory below reads it per request and
// points an AG-UI HttpAgent at that URL.
//
// A session token, if the server requires one, is sent as the
// `X-Hermes-Session-Token` header. The CopilotKit runtime auto-forwards the
// `Authorization` header and every `x-*` header to the agent's transport, so
// the token reaches `hermes-agui` without any handling here.
//
// `HermesAgent` (from @ag-ui/hermes) is a thin `HttpAgent` subclass — same
// `{ url }` constructor — that speaks the Hermes AG-UI adapter's protocol.
const DEFAULT_HERMES_URL = process.env.AGENT_URL || "http://127.0.0.1:8000/";

const runtime = new CopilotRuntime({
  // Per-request factory: resolve the target Hermes server from the browser's
  // `X-Hermes-Url` header, falling back to AGENT_URL for a headless/default run.
  agents: ({ request }) => {
    const url = request.headers.get("x-hermes-url") || DEFAULT_HERMES_URL;
    return { default: new HermesAgent({ url }) };
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
  // Open Generative UI powers the "Calculator" demo (the model emits a
  // sandboxed UI). No A2UI catalog or MCP apps: those served the showcase's
  // server-tool demos, which a generic Hermes agent doesn't have.
  openGenerativeUI: true,
});

const app = createCopilotEndpoint({
  runtime,
  basePath: "/api/copilotkit",
});

export const GET = handle(app);
export const POST = handle(app);
export const PATCH = handle(app);
export const DELETE = handle(app);
