import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import type { AbstractAgent } from "@ag-ui/client";
import { HttpAgent } from "@ag-ui/client";

// The agent backend runs as a separate process on port 8000.
// This runtime proxies CopilotKit requests to it via AG-UI protocol.
const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

console.log("[copilotkit/route] Initializing CopilotKit runtime");
console.log(`[copilotkit/route] AGENT_URL: ${AGENT_URL}`);

// Per-request request/response logging is gated behind this flag (default off).
// Under d6 probe fan-out, unconditional per-request logs flooded Railway's
// 500-logs/sec cap and killed the replica ("Messages dropped" → container stop).
// Set SHOWCASE_ROUTE_DEBUG=1 to re-enable verbose per-request tracing locally.
const ROUTE_DEBUG =
  process.env.SHOWCASE_ROUTE_DEBUG === "1" ||
  process.env.SHOWCASE_ROUTE_DEBUG === "true";

function createAgent(path = "/chat") {
  const feature = path.replace(/^\/+/, "");
  return new HttpAgent({
    url: `${AGENT_URL}/conversational_flows/${feature}`,
  });
}

// Register the frontend-facing agent aliases used by the shared CrewAI demo
// components. The default aliases route to the conversational chat Flow;
// feature-specific aliases below select their dedicated conversational Flow.
// See
// ../../../../PARITY_NOTES.md (integration root).
const agentNames = [
  // Existing base demos
  "agentic_chat",
  "human_in_the_loop",
  "tool-rendering",
  "gen-ui-tool-based",
  "gen-ui-agent",
  "shared-state-read",
  "shared-state-write",
  "shared-state-streaming",
  "shared-state-read-write",
  "subagents",
  // Chrome / headless
  "prebuilt-sidebar",
  "prebuilt-popup",
  "chat-slots",
  "chat-customization-css",
  "headless-simple",
  "headless-complete",
  // Frontend tools / context
  "frontend_tools",
  "frontend-tools-async",
  "readonly-state-agent-context",
  "agent-config",
  // Tool rendering variants
  "tool-rendering-default-catchall",
  "tool-rendering-reasoning-chain",
  // HITL
  "hitl-in-chat",
  "hitl-in-app",
  // Open-ended generative UI
  "open-gen-ui",
  "open-gen-ui-advanced",
];

// Reasoning variants share a native CrewAI Flow. The CrewAI bridge translates
// the reasoning-model stream into AG-UI reasoning and text lifecycles.
const reasoningAgentNames = [
  "reasoning-default",
  "reasoning-custom",
  "reasoning-default-render",
  "agentic-chat-reasoning",
];

const agents: Record<string, AbstractAgent> = {};
for (const name of agentNames) {
  agents[name] = createAgent();
}

// Conversational Flows own the state, tool-result, and delegation lifecycles for
// these cells. Keep every alias explicit: silently falling back to the root
// chat endpoint makes the UI appear connected while dropping the specialized
// AG-UI events that each demo exists to prove.
agents["shared-state-read"] = createAgent("/shared-state-read");
agents["shared-state-write"] = createAgent("/shared-state-read-write");
agents["shared-state-streaming"] = createAgent("/shared-state-streaming");
agents["shared-state-read-write"] = createAgent("/shared-state-read-write");
agents["subagents"] = createAgent("/subagents");
agents["tool-rendering"] = createAgent("/tool-rendering");
agents["tool-rendering-default-catchall"] = createAgent("/tool-rendering");
agents["tool-rendering-custom-catchall"] = createAgent("/tool-rendering");
agents["tool-rendering-reasoning-chain"] = createAgent(
  "/tool-rendering-reasoning",
);
agents["frontend_tools"] = createAgent("/frontend-tools");
agents["frontend-tools-async"] = createAgent("/frontend-tools");
agents["human_in_the_loop"] = createAgent("/frontend-tools");
agents["hitl-in-chat"] = createAgent("/frontend-tools");
agents["hitl-in-app"] = createAgent("/frontend-tools");
agents["headless-complete"] = createAgent("/tool-rendering");
agents["open-gen-ui"] = createAgent("/frontend-tools");
agents["open-gen-ui-advanced"] = createAgent("/frontend-tools");
for (const name of reasoningAgentNames) {
  agents[name] = createAgent("/reasoning");
}
// Interrupt-adapted demos route to the dedicated scheduling Flow backend.
// Both gen-ui-interrupt and interrupt-headless share the same Flow; only the
// frontend UX differs (inline in chat vs. external popup).
agents["gen-ui-interrupt"] = createAgent("/interrupt");
agents["interrupt-headless"] = createAgent("/interrupt");
// gen-ui-agent routes to a dedicated CrewAI Flow backend that owns the
// `set_steps` tool + per-call STATE_SNAPSHOT emit (see
// src/agents/gen_ui_agent.py).
agents["gen-ui-agent"] = createAgent("/gen-ui-agent");
// tool-rendering-custom-catchall routes to a dedicated CrewAI Flow
// backend (`/tool-rendering`, src/agents/tool_rendering.py) that emits
// AG-UI TOOL_CALL_* events for `get_weather` / `get_stock_price` so the
// frontend's custom wildcard renderer paints the expected card shell.
agents["default"] = createAgent();

console.log(
  `[copilotkit/route] Registered ${Object.keys(agents).length} agent names: ${Object.keys(agents).join(", ")}`,
);

export const POST = async (req: NextRequest) => {
  const url = req.url;
  const contentType = req.headers.get("content-type");
  if (ROUTE_DEBUG) {
    console.log(
      `[copilotkit/route] POST ${url} (content-type: ${contentType})`,
    );
  }

  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit",
      serviceAdapter: new ExperimentalEmptyAdapter(),
      runtime: new CopilotRuntime({
        // @ts-ignore -- Published CopilotRuntime agents type wraps Record in MaybePromise<NonEmptyRecord<...>> which rejects plain Records; fixed in source, pending release
        agents,
      }),
    });

    const response = await handleRequest(req);
    if (!response.ok) {
      console.log(`[copilotkit/route] Response status: ${response.status}`);
    } else if (ROUTE_DEBUG) {
      console.log(`[copilotkit/route] Response status: ${response.status}`);
    }
    return response;
  } catch (error: unknown) {
    // Log full details server-side (operators grep `errorId` to correlate),
    // but never echo `err.message` / `err.stack` back to the HTTP client —
    // that leaks internal paths, dependency versions, and stack traces.
    const err = error instanceof Error ? error : new Error(String(error));
    const errorId = crypto.randomUUID();
    console.error(
      JSON.stringify({
        at: new Date().toISOString(),
        level: "error",
        scope: "copilotkit/route",
        errorId,
        message: err.message,
        stack: err.stack,
      }),
    );
    return NextResponse.json(
      { error: "internal runtime error", errorId },
      { status: 500 },
    );
  }
};

export const GET = async () => {
  if (ROUTE_DEBUG) {
    console.log("[copilotkit/route] GET /api/copilotkit (health probe)");
  }

  let agentStatus = "unknown";
  try {
    const res = await fetch(`${AGENT_URL}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    agentStatus = res.ok ? "reachable" : `error (${res.status})`;
  } catch (e: unknown) {
    agentStatus = `unreachable (${(e as Error).message})`;
  }

  return NextResponse.json({
    status: "ok",
    agent_url: AGENT_URL,
    agent_status: agentStatus,
    env: {
      OPENAI_API_KEY: process.env.OPENAI_API_KEY ? "set" : "NOT SET",
      NODE_ENV: process.env.NODE_ENV,
    },
  });
};
