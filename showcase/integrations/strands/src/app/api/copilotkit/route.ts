import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
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

function createAgent(path = "/") {
  return new HttpAgent({ url: `${AGENT_URL}${path}` });
}

// Register the same agent under all names used by demo pages.
// Strands runs a single shared backend agent; per-demo differentiation
// happens on the frontend (useFrontendTool / useRenderTool / useHumanInTheLoop
// / useAgentContext / A2UI catalogs). Every demo page's `agent=` prop must
// resolve to a name in this list.
const agentNames = [
  // Original blitz set
  "agentic_chat",
  "human_in_the_loop",
  "tool-rendering",
  "gen-ui-tool-based",
  "gen-ui-agent",
  "shared-state-read",
  "shared-state-write",
  "shared-state-streaming",
  "subagents",
  // Chat UI / chrome demos
  "chat-customization-css",
  "prebuilt-sidebar",
  "prebuilt-popup",
  "chat-slots",
  "headless-simple",
  "headless-complete",
  // Reasoning
  "reasoning-default",
  "reasoning-custom",
  // Frontend tools
  "frontend_tools",
  "frontend-tools-async",
  // HITL
  "hitl-in-chat",
  "hitl-in-app",
  // Tool rendering variants
  "tool-rendering-default-catchall",
  "tool-rendering-custom-catchall",
  "tool-rendering-reasoning-chain",
  // State / context
  "readonly-state-agent-context",
  "shared-state-read-write",
  // A2UI
  "declarative-gen-ui",
  "a2ui-fixed-schema",
  // Modalities
  "multimodal",
  "voice",
  // Misc
  "auth",
  "agent-config",
  // BYOC renderers (wave 2)
  "byoc-hashbrown-demo",
  "byoc_json_render",
  // Open Generative UI (wave 2)
  "open-gen-ui",
  "open-gen-ui-advanced",
  // Polished chat shell (simplified port — wave 2 follow-up)
  "beautiful-chat",
  // Interrupt demos, served by the dedicated native-interrupt agent below
  "gen-ui-interrupt",
  "interrupt-headless",
];

// Agent names whose backend is a dedicated sub-application rather than the
// shared agent at the root. The interrupt demos need a `schedule_meeting` that
// pauses natively; the reasoning demos need the Responses API with reasoning
// summaries, which the shared chat-completions agent does not emit.
const dedicatedAgentPaths: Record<string, string> = {
  "gen-ui-interrupt": "/interrupt/",
  "interrupt-headless": "/interrupt/",
  "reasoning-default": "/reasoning/",
  "reasoning-custom": "/reasoning/",
  "tool-rendering-reasoning-chain": "/reasoning-chain/",
};

const agents: Record<string, AbstractAgent> = {};
for (const name of agentNames) {
  agents[name] = createAgent(dedicatedAgentPaths[name] ?? "/");
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
    const copilotHandler = createCopilotRuntimeHandler({
      runtime: new CopilotRuntime({
        // @ts-ignore -- Published CopilotRuntime agents type wraps Record in MaybePromise<NonEmptyRecord<...>> which rejects plain Records; fixed in source, pending release
        agents,
      }),
      basePath: "/api/copilotkit",
      mode: "single-route",
    });

    const response = await copilotHandler(req);
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
