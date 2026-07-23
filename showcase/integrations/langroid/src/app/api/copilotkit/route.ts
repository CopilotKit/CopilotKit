import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { AbstractAgent, HttpAgent } from "@ag-ui/client";

// The agent backend runs as a separate process on port 8000.
// This runtime proxies CopilotKit requests to it via AG-UI protocol.
const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

// Per-request request/response logging is gated behind this flag (default off).
// Under d6 probe fan-out, unconditional per-request logs flooded Railway's
// 500-logs/sec cap and killed the replica ("Messages dropped" → container stop).
// Set SHOWCASE_ROUTE_DEBUG=1 to re-enable verbose per-request tracing locally.
const ROUTE_DEBUG =
  process.env.SHOWCASE_ROUTE_DEBUG === "1" ||
  process.env.SHOWCASE_ROUTE_DEBUG === "true";

console.log("[copilotkit/route] Initializing CopilotKit runtime");
console.log(`[copilotkit/route] AGENT_URL: ${AGENT_URL}`);

function createAgent(path = "/") {
  return new HttpAgent({ url: `${AGENT_URL}${path}` });
}

// Register the same agent under all names used by demo pages.
// The Langroid agent_server.py exposes a single unified agent on "/" that
// handles every request — so every entry here maps to the same HttpAgent.
const agentNames = [
  "agentic_chat",
  "human_in_the_loop",
  "tool-rendering",
  "gen-ui-tool-based",
  "gen-ui-agent",
  "shared-state-read",
  "shared-state-write",
  "shared-state-read-write",
  "shared-state-streaming",
  "subagents",
  // Chat chrome variants — all share the unified agent. The frontend
  // differentiates via UI composition only (CopilotChat vs Sidebar vs Popup,
  // slots, headless useAgent).
  "chat-customization-css",
  "prebuilt-sidebar",
  "prebuilt-popup",
  "chat-slots",
  "headless-simple",
  // Frontend-tools variants — backend has no specialized tools; the frontend
  // registers handlers via useFrontendTool and the agent calls them.
  "frontend_tools",
  "frontend-tools-async",
  // HITL variants — use existing agent's schedule_meeting flow.
  "hitl-in-chat",
  "hitl-in-app",
  // Read-only agent context — frontend exposes useAgentContext; same agent.
  "readonly-state-agent-context",
  // Tool rendering variants — all share the unified agent; frontend differs.
  "tool-rendering-default-catchall",
  "tool-rendering-custom-catchall",
  "tool-rendering-reasoning-chain",
  // Declarative A2UI + fixed-schema A2UI — use the agent's generate_a2ui tool.
  "declarative-gen-ui",
  "a2ui-fixed-schema",
  // Agent-config, open-gen-ui, headless-complete all reuse the unified agent.
  "agent-config",
  "open-gen-ui",
  "open-gen-ui-advanced",
  "headless-complete",
  // Interrupt demos (Strategy B — frontend-tool async handler)
  "gen-ui-interrupt",
  "interrupt-headless",
];

// Reasoning agent names — backed by the reasoning-enabled sub-app at
// /reasoning. Langroid's stock unified agent calls OpenAI non-streaming and
// drops the model's reasoning_content channel, so reasoning cells route here
// instead. Emits AG-UI REASONING_MESSAGE_* events that the frontend renders
// via the `reasoningMessage` slot (built-in card for `reasoning-default`,
// custom amber ReasoningBlock for `reasoning-custom`). `agentic-chat-reasoning`
// and `reasoning-default-render` are legacy aliases kept for any cell that
// still references them.
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
for (const name of reasoningAgentNames) {
  agents[name] = createAgent("/reasoning/");
}
agents["default"] = createAgent();

// gen-ui-agent owns a typed `steps` slice of shared state that the
// unified `/` agent does not implement (it has no `set_steps` tool).
// Route this agent name at a dedicated backend endpoint that drives
// the pending -> in_progress -> completed state machine and emits
// STATE_SNAPSHOT events between transitions.
agents["gen-ui-agent"] = new HttpAgent({ url: `${AGENT_URL}/gen-ui-agent` });

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
