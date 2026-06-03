import {
  CopilotKitIntelligence,
  CopilotRuntime,
  InMemoryAgentRunner,
  createCopilotEndpoint,
} from "@copilotkit/runtime/v2";
import type { AbstractAgent } from "@ag-ui/client";
import { HttpAgent } from "@ag-ui/client";
import { handle } from "hono/vercel";

// The agent backend runs as a separate process on port 8000.
// This runtime proxies CopilotKit requests to it via AG-UI protocol.
const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

console.log("[copilotkit/route] Initializing CopilotKit runtime");
console.log(`[copilotkit/route] AGENT_URL: ${AGENT_URL}`);

function createAgent(path = "/") {
  return new HttpAgent({ url: `${AGENT_URL}${path}` });
}

// Register the same default agent under all shared names used by demo
// pages. AG2's AGUIStream wraps a single ConversableAgent; most names
// proxy to the same backend process. Frontend-only variations (slots,
// sidebar, CSS theming, headless chat, tool rendering wildcards, etc.)
// all reuse the shared `agent.py` ConversableAgent under a unique
// registered name.
const sharedAgentNames = [
  "agentic_chat",
  "human_in_the_loop",
  "tool-rendering",
  "gen-ui-tool-based",
  "shared-state-read",
  "shared-state-write",
  "shared-state-streaming",
  // Frontend-only variants (Batch 1) — same ConversableAgent, different UI.
  "prebuilt-sidebar",
  "prebuilt-popup",
  "chat-slots",
  "chat-customization-css",
  "headless-simple",
  "readonly-state-agent-context",
  "reasoning-default-render",
  "tool-rendering-default-catchall",
  "tool-rendering-custom-catchall",
  "frontend_tools",
  "frontend-tools-async",
  "hitl-in-app",
  "hitl-in-chat",
  "agentic-chat-reasoning",
];

// Demos that own a dedicated FastAPI sub-app (mounted at a named path
// in `agent_server.py`). Each gets its own HttpAgent pointed at that
// path so its ContextVariables state slot is isolated from the shared
// default agent.
const dedicatedAgents: Record<string, string> = {
  "shared-state-read-write": "/shared-state-read-write/",
  subagents: "/subagents/",
  "headless-complete": "/headless-complete/",
  "tool-rendering-reasoning-chain": "/tool-rendering-reasoning-chain/",
  "agent-config-demo": "/agent-config/",
  "gen-ui-agent": "/gen-ui-agent/",
};

// Interrupt-adapted demos: gen-ui-interrupt and interrupt-headless share the
// same AG2 scheduling agent at /interrupt-adapted. The agent has tools=[];
// `schedule_meeting` is provided by the frontend via `useFrontendTool`.
const interruptAgentNames = ["gen-ui-interrupt", "interrupt-headless"];

const agents: Record<string, AbstractAgent> = {};
for (const name of sharedAgentNames) {
  agents[name] = createAgent();
}
for (const [name, path] of Object.entries(dedicatedAgents)) {
  agents[name] = createAgent(path);
}
for (const name of interruptAgentNames) {
  agents[name] = createAgent("/interrupt-adapted/");
}
agents["default"] = createAgent();

console.log(
  `[copilotkit/route] Registered ${Object.keys(agents).length} agent names: ${Object.keys(agents).join(", ")}`,
);

const intelligenceRuntimeConfig = process.env.COPILOTKIT_LICENSE_TOKEN
  ? {
      intelligence: new CopilotKitIntelligence({
        apiKey: process.env.INTELLIGENCE_API_KEY ?? "",
        apiUrl: process.env.INTELLIGENCE_API_URL ?? "http://localhost:4201",
        wsUrl: process.env.INTELLIGENCE_GATEWAY_WS_URL ?? "ws://localhost:4401",
      }),
      identifyUser: async () => ({
        id: "demo-user",
        name: "Demo User",
      }),
      licenseToken: process.env.COPILOTKIT_LICENSE_TOKEN,
    }
  : { runner: new InMemoryAgentRunner() };

const runtime = new CopilotRuntime({
  // @ts-expect-error -- Published CopilotRuntime agents type wraps Record in MaybePromise<NonEmptyRecord<...>> which rejects plain Records; fixed in source, pending release
  agents,
  ...intelligenceRuntimeConfig,
});

const app = createCopilotEndpoint({
  runtime,
  basePath: "/api/copilotkit",
});

export const GET = handle(app);
export const POST = handle(app);
export const PATCH = handle(app);
export const DELETE = handle(app);
