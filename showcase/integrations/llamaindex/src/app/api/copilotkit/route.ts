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

// Per-request request/response logging is gated behind this flag (default off).
// Under d6 probe fan-out, unconditional per-request logs flooded Railway's
// 500-logs/sec cap and killed the replica ("Messages dropped" → container stop).
// Set SHOWCASE_ROUTE_DEBUG=1 to re-enable verbose per-request tracing locally.
const ROUTE_DEBUG =
  process.env.SHOWCASE_ROUTE_DEBUG === "1" ||
  process.env.SHOWCASE_ROUTE_DEBUG === "true";

console.log("[copilotkit/route] Initializing CopilotKit runtime");
console.log(`[copilotkit/route] AGENT_URL: ${AGENT_URL}`);

function createAgent(subpath: string = "") {
  return new HttpAgent({ url: `${AGENT_URL}${subpath}/run` });
}

// Shared-router agents — every id here resolves to the same backend + same
// tool set. Per-demo behavior is driven by the frontend (tools, suggestions,
// render slots).
const sharedAgentNames = [
  "agentic_chat",
  "tool-rendering",
  "tool-rendering-default-catchall",
  "tool-rendering-custom-catchall",
  "shared-state-read",
  "shared-state-write",
  "shared-state-streaming",
  "frontend_tools",
  "prebuilt_sidebar",
  "prebuilt_popup",
  "chat_slots",
  "chat_customization_css",
  "headless_simple",
  "headless_complete",
  "readonly_state_agent_context",
  "human_in_the_loop",
  // Hyphenated aliases matching what the demo pages actually request
  // (mirrors langgraph-python's naming). The underscore names above are
  // kept as additive aliases.
  "prebuilt-sidebar",
  "prebuilt-popup",
  "chat-slots",
  "chat-customization-css",
  "headless-simple",
  "headless-complete",
  "readonly-state-agent-context",
  // Requested by demos/threadid-frontend-tool-roundtrip via /api/copilotkit;
  // no dedicated agent_server.py mount exists — the shared default router
  // serves it.
  "threadid-frontend-tool-roundtrip",
];

// Specialized routers live at dedicated subpaths on the agent_server so the
// distinct system prompt / tool set / model can surface through this same
// runtime. Each subpath matches the `include_router(..., prefix=)` in
// src/agent_server.py.
const specializedAgents: Record<string, string> = {
  "agentic-chat-reasoning": "/reasoning",
  "reasoning-default-render": "/reasoning",
  "tool-rendering-reasoning-chain": "/tool-rendering-reasoning-chain",
  "shared-state-read-write": "/shared-state-read-write",
  "gen-ui-agent": "/gen-ui-agent",
  "gen-ui-tool-based": "/gen-ui-tool-based",
  // frontend-tools-async injects an async `query_notes` useFrontendTool at
  // request time; its dedicated router (make_request_aware_router) forwards
  // injected tools, which the shared FixedAGUIChatWorkflow catch-all does not.
  // Both the hyphenated (page-requested) and underscore (alias) ids route here.
  "frontend-tools-async": "/frontend-tools-async",
  frontend_tools_async: "/frontend-tools-async",
  "beautiful-chat": "/beautiful-chat",
  hitl_in_app: "/hitl-in-app",
  // Hyphenated names the hitl demo pages actually request. Both route to
  // the DEDICATED routers mounted in src/agent_server.py (lines ~105-106) —
  // a sharedAgentNames alias would silently route them to the default
  // backend instead.
  "hitl-in-app": "/hitl-in-app",
  "hitl-in-chat": "/hitl-in-chat",
  subagents: "/subagents",
  // Interrupt-adapted scheduling demos — both gen-ui-interrupt and
  // interrupt-headless share the same backend agent; only the frontend
  // UX differs (inline picker in chat vs. external popup).
  "gen-ui-interrupt": "/interrupt",
  "interrupt-headless": "/interrupt",
};

const agents: Record<string, AbstractAgent> = {};
for (const name of sharedAgentNames) {
  agents[name] = createAgent();
}
for (const [name, subpath] of Object.entries(specializedAgents)) {
  agents[name] = createAgent(subpath);
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
        // @ts-expect-error -- see main route.ts; published CopilotRuntime's `agents`
        // type wraps Record in MaybePromise<NonEmptyRecord<...>> which rejects
        // plain Records. Fixed in source, pending release.
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
    const err = error as Error;
    console.error(`[copilotkit/route] ERROR: ${err.message}`);
    console.error(`[copilotkit/route] Stack: ${err.stack}`);
    return NextResponse.json(
      { error: err.message, stack: err.stack },
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
