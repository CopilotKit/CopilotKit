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

console.log("[copilotkit/route] Initializing CopilotKit runtime");
console.log(`[copilotkit/route] AGENT_URL: ${AGENT_URL}`);

// Per-request request/response logging is gated behind this flag (default off).
// Under d6 probe fan-out, unconditional per-request logs flooded Railway's
// 500-logs/sec cap and killed the replica ("Messages dropped" → container stop).
// Set SHOWCASE_ROUTE_DEBUG=1 to re-enable verbose per-request tracing locally.
const ROUTE_DEBUG =
  process.env.SHOWCASE_ROUTE_DEBUG === "1" ||
  process.env.SHOWCASE_ROUTE_DEBUG === "true";

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
  "tool-rendering-default-catchall",
  "tool-rendering-custom-catchall",
  "frontend_tools",
  "frontend-tools-async",
  "hitl-in-app",
  "hitl-in-chat",
];

// Reasoning agent names — backed by the reasoning-enabled AG2 agent at
// /reasoning. Emits AG-UI REASONING_MESSAGE_* events that the frontend
// renders via the `reasoningMessage` slot (built-in card for
// `reasoning-default`, custom amber ReasoningBlock for `reasoning-custom`).
// The demo pages use the ids `reasoning-default` / `reasoning-custom`; both
// share the one reasoning backend. `agentic-chat-reasoning` and
// `reasoning-default-render` are legacy aliases kept for any cell that still
// references them.
const reasoningAgentNames = [
  "reasoning-default",
  "reasoning-custom",
  "reasoning-default-render",
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
for (const name of reasoningAgentNames) {
  agents[name] = createAgent("/reasoning/");
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
