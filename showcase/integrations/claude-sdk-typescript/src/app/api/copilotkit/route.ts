import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import type { AbstractAgent } from "@ag-ui/client";
import { createClaudeHttpAgent } from "@/app/api/_shared/claude-http-agent";
import { internalRuntimeErrorResponse } from "@/app/api/_shared/route-error";
// CVDIAG backend instrumentation (L1-E). No-op pass-through unless
// CVDIAG_BACKEND_EMITTER is set truthy (default OFF).
import { withCvdiagBackend } from "@/cvdiag-backend";

// The Claude agent backend runs as a separate TypeScript process on port 8000.
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

function createAgent() {
  return createClaudeHttpAgent(`${AGENT_URL}/`);
}

// Register the same agent under all names used by demo pages.
// The Claude Agent SDK (TypeScript) backend is a pass-through: it forwards
// whatever tools the AG-UI client provides (frontend-registered via
// useFrontendTool / useRenderTool, plus runtime-injected tools from
// openGenerativeUI / a2ui / mcpApps middleware) to Claude. So distinct
// agent behaviour across demos comes from the frontend, not a per-demo
// backend graph — every demo can share the same HttpAgent target.
// IMPORTANT — read the override block BELOW this list before changing
// any entry: ids marked "NOT pass-through" in the override block are
// re-pointed at dedicated backend endpoints after this loop runs (e.g.
// `gen-ui-agent`, `tool-rendering`, `tool-rendering-*-catchall`,
// `tool-rendering-reasoning-chain`, `subagents`, `shared-state-read-write`,
// `headless-complete`). Those ids appear here only so `Object.keys(agents)`
// enumerates them and probes against the shared runtime resolve cleanly;
// the override block is the source of truth for which backend URL they
// actually hit.
const agentNames = [
  // existing demos
  "agentic_chat",
  "agentic-chat",
  "human_in_the_loop",
  "tool-rendering", // overridden -> /tool-rendering (NOT pass-through)
  "hitl",
  "gen-ui-tool-based",
  "gen-ui-agent", // overridden -> /gen-ui-agent (NOT pass-through)
  "shared-state-read",
  "shared-state-write",
  "shared-state-streaming", // overridden -> /shared-state-streaming
  "subagents", // overridden -> /subagents (NOT pass-through)
  "shared-state-read-write", // overridden -> /shared-state-read-write (NOT pass-through)
  "headless-complete", // overridden -> /headless-complete (NOT pass-through)
  // newly ported demos
  "prebuilt-sidebar",
  "prebuilt-popup",
  "chat-slots",
  "chat-customization-css",
  "headless-simple",
  "frontend_tools",
  "threadid-frontend-tool-roundtrip",
  "frontend-tools-async",
  "hitl-in-chat",
  "hitl-in-chat-booking",
  "hitl-in-app",
  "readonly-state-agent-context",
  // runtime-injected demos (A2UI, open-gen-ui, mcp-apps live on dedicated
  // runtimes; here we register the ids so intra-app links and probe
  // requests resolve cleanly against the default runtime too)
  "declarative-gen-ui",
  "open-gen-ui",
  "open-gen-ui-advanced",
  "mcp-apps",
  // post-#4271 demos — each lives on a dedicated runtime, but we register
  // their agent ids here so probes against the shared runtime resolve
  // without 404s.
  "byoc_json_render",
  "declarative_json_render",
  "declarative-hashbrown-demo",
  "beautiful-chat",
  "multimodal-demo",
  "voice-demo",
  "agent-config-demo",
  "auth-demo",
  // Interrupt-adapted scheduling demos — both use useFrontendTool with an
  // async handler to simulate LangGraph interrupt(); the backend is the same
  // pass-through agent.
  "gen-ui-interrupt",
  "interrupt-headless",
  // showcase-fill-186 ports — NOT pass-through: backend owns the tools.
  // See override block below; entries here only seed Object.keys(agents)
  // for probe enumeration.
  "tool-rendering-default-catchall", // overridden -> /tool-rendering
  "tool-rendering-custom-catchall", // overridden -> /tool-rendering
  "tool-rendering-reasoning-chain", // overridden -> /tool-rendering-reasoning-chain
  // Reasoning variants — overridden -> /reasoning (NOT pass-through).
  "reasoning-default",
  "reasoning-custom",
];

const agents: Record<string, AbstractAgent> = {};
for (const name of agentNames) {
  agents[name] = createAgent();
}
agents["default"] = createAgent();

// Gen UI (Agent-based) is NOT a pass-through demo: the backend owns the
// `set_steps` tool and streams `state.steps` via STATE_SNAPSHOT (see
// `src/agent_server.ts` `/gen-ui-agent`). Point it at the dedicated
// endpoint — on the pass-through root the model's set_steps calls were
// forwarded to the frontend (which registers no such tool) and the
// multi-leg tool loop never completed.
agents["gen-ui-agent"] = createClaudeHttpAgent(`${AGENT_URL}/gen-ui-agent`);

// Tool Rendering family is likewise NOT pass-through: the pages register
// render-only hooks (no handlers), so frontend execution never returns a
// result and every card stalls in its loading state. The backend owns
// get_weather / search_flights / get_stock_price / roll_d20 at
// `/tool-rendering` (see `src/agent_server.ts`), and the reasoning-chain
// variant adds extended thinking + roll_dice at
// `/tool-rendering-reasoning-chain`.
agents["tool-rendering"] = createClaudeHttpAgent(`${AGENT_URL}/tool-rendering`);
agents["tool-rendering-default-catchall"] = createClaudeHttpAgent(
  `${AGENT_URL}/tool-rendering`,
);
agents["tool-rendering-custom-catchall"] = createClaudeHttpAgent(
  `${AGENT_URL}/tool-rendering`,
);
agents["tool-rendering-reasoning-chain"] = createClaudeHttpAgent(
  `${AGENT_URL}/tool-rendering-reasoning-chain`,
);

// Sub-Agents is NOT pass-through: the backend owns the
// research / writing / critique sub-agent tools and emits delegation
// progress via STATE_SNAPSHOT (see `src/agent_server.ts` `/subagents`).
// The demo page targets `/api/copilotkit-subagents` directly, but probes
// landing on the shared runtime must hit the dedicated backend endpoint
// too — otherwise the pass-through root forwards the supervisor's
// sub-agent tool calls to the frontend (which registers nothing) and the
// multi-leg loop stalls. Mirrors the gen-ui-agent treatment above.
agents["subagents"] = createClaudeHttpAgent(`${AGENT_URL}/subagents`);

// Shared State (Read + Write) is NOT pass-through: the backend reads
// `input.state.preferences` into the system prompt every turn and owns
// the `set_notes` tool that mutates `state.notes` (see
// `src/agent_server.ts` `/shared-state-read-write`). The demo page
// targets `/api/copilotkit-shared-state-read-write` directly; this
// override keeps shared-runtime probes resolving against the same
// backend endpoint so a probe never silently exercises the pass-through.
agents["shared-state-read-write"] = createClaudeHttpAgent(
  `${AGENT_URL}/shared-state-read-write`,
);

agents["shared-state-streaming"] = createClaudeHttpAgent(
  `${AGENT_URL}/shared-state-streaming`,
);

// Headless Chat (Complete) is NOT pass-through: the backend owns
// `get_weather` and `get_stock_price` (see `src/agent_server.ts`
// `/headless-complete`). The demo page targets
// `/api/copilotkit-headless-complete` directly, but registering the id
// here with the same backend URL keeps shared-runtime probes 200-resolving
// against the real handler (matching the file's probe-resolution
// convention for dedicated-runtime demos).
agents["headless-complete"] = createClaudeHttpAgent(
  `${AGENT_URL}/headless-complete`,
);

agents["byoc_json_render"] = createClaudeHttpAgent(
  `${AGENT_URL}/byoc-json-render`,
);

agents["mcp-apps"] = createClaudeHttpAgent(`${AGENT_URL}/mcp-apps`);

// Reasoning variants share the same backend endpoint; the frontend decides
// whether to render the default or custom reasoning slot.
agents["reasoning-default"] = createClaudeHttpAgent(`${AGENT_URL}/reasoning`);
agents["reasoning-custom"] = createClaudeHttpAgent(`${AGENT_URL}/reasoning`);

console.log(
  `[copilotkit/route] Registered ${Object.keys(agents).length} agent names: ${Object.keys(agents).join(", ")}`,
);

const copilotkitPost = async (req: NextRequest): Promise<Response> => {
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
    const err = error as Error;
    console.error(`[copilotkit/route] ERROR: ${err.message}`);
    console.error(`[copilotkit/route] Stack: ${err.stack}`);
    return internalRuntimeErrorResponse("/api/copilotkit", error);
  }
};

// Wrap with CVDIAG backend instrumentation (L1-E). The Claude Agent SDK (TS)
// backend is a pass-through proxy with no per-request named agent, so a fixed
// `agent_name` is stamped. No-op pass-through unless CVDIAG_BACKEND_EMITTER is
// set truthy (default OFF).
export const POST = withCvdiagBackend(copilotkitPost, {
  slug: "claude-sdk-typescript",
  agentName: "claude-agent",
  provider: "anthropic",
});

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
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ? "set" : "NOT SET",
      NODE_ENV: process.env.NODE_ENV,
    },
  });
};
