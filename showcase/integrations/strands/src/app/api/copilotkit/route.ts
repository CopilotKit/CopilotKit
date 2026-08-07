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

// HttpAgent path helper. Trailing slash is required so FastAPI sub-app roots
// (agent_server.py `app.mount("/…", …)`) resolve correctly.
function createAgent(path = "/") {
  const normalized =
    path === "/" ? "/" : path.endsWith("/") ? path : `${path}/`;
  return new HttpAgent({ url: `${AGENT_URL}${normalized}` });
}

// Chrome / UI / docs demos that share the neutral showcase agent at "/".
// Per-demo differentiation happens on the frontend (useFrontendTool /
// useRenderTool / useHumanInTheLoop / useAgentContext / A2UI catalogs).
const neutralAgentNames = [
  // Original blitz set
  "agentic_chat",
  "human_in_the_loop",
  "tool-rendering",
  "gen-ui-tool-based",
  "gen-ui-agent",
  "shared-state-read",
  "shared-state-write",
  "subagents",
  // Chat UI / chrome demos
  "chat-customization-css",
  "prebuilt-sidebar",
  "prebuilt-popup",
  "chat-slots",
  "headless-simple",
  // Frontend tools
  "frontend_tools",
  "frontend-tools-async",
  // HITL (in-app uses async frontend tool; step-based hitl is frontend-driven)
  "hitl-in-app",
  // Tool rendering variants (non-reasoning)
  "tool-rendering-default-catchall",
  "tool-rendering-custom-catchall",
  // State / context
  "readonly-state-agent-context",
  "shared-state-read-write",
  // Modalities (main-route registrations; dedicated runtimes also exist)
  "multimodal",
  // Misc
  "auth",
  "agent-config",
  // Interrupt demos (Strategy B — frontend-tool async handler; quarantined
  // in not_supported_features pending react-core resume-path fix)
  "gen-ui-interrupt",
  "interrupt-headless",
];

const agents: Record<string, AbstractAgent> = {};
for (const name of neutralAgentNames) {
  agents[name] = createAgent();
}

// D6 specialized backends — map agent= names used by demo pages onto the
// dedicated mounts registered in agent_server.py. Mirrors ms-agent-python /
// LGP: different agent names can use different HttpAgent URLs.
//
// Reasoning variants share one backend; the only frontend difference is
// whether messageView.reasoningMessage is overridden.
agents["reasoning-default"] = createAgent("/reasoning");
agents["reasoning-custom"] = createAgent("/reasoning");
agents["tool-rendering-reasoning-chain"] = createAgent(
  "/tool-rendering-reasoning-chain",
);
agents["shared-state-streaming"] = createAgent("/shared-state-streaming");
agents["hitl-in-chat"] = createAgent("/hitl-in-chat");

// Names also registered on dedicated Next.js runtimes (ogui / beautiful-chat
// / mcp-apps / voice / a2ui / byoc). Keep them here so a misconfigured page
// that hits /api/copilotkit still resolves, and so probes that enumerate
// the main runtime agent map see the full D6 surface.
agents["headless-complete"] = createAgent("/headless-complete");
agents["beautiful-chat"] = createAgent("/beautiful-chat");
agents["open-gen-ui"] = createAgent("/open-gen-ui");
agents["open-gen-ui-advanced"] = createAgent("/open-gen-ui-advanced");
agents["mcp-apps"] = createAgent("/mcp-apps");
agents["voice"] = createAgent("/voice");
agents["declarative-gen-ui"] = createAgent("/declarative-gen-ui");
agents["a2ui-fixed-schema"] = createAgent("/a2ui-fixed-schema");
agents["a2ui-recovery"] = createAgent("/a2ui-recovery");
agents["byoc-hashbrown-demo"] = createAgent("/byoc-hashbrown");
agents["byoc_json_render"] = createAgent("/byoc-json-render");

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
        // NOTE: A2UI / openGenerativeUI / mcpApps are intentionally NOT
        // enabled here. Dedicated runtimes own those flags so they don't
        // bleed into chrome demos that share this endpoint:
        //   - /api/copilotkit-declarative-gen-ui, /api/copilotkit-a2ui-fixed-schema,
        //     /api/copilotkit-a2ui-recovery
        //   - /api/copilotkit-ogui
        //   - /api/copilotkit-mcp-apps
        //   - /api/copilotkit-beautiful-chat (combined)
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
