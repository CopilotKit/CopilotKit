import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import type { AbstractAgent, HttpAgentConfig } from "@ag-ui/client";
import { HttpAgent } from "@ag-ui/client";
import { AsyncLocalStorage } from "node:async_hooks";

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

// Per-request inbound x-* forwarding over the HttpAgent proxy hop. The Next
// route is a bare proxy; the model call happens in the Express agent (:8000).
// @ag-ui/client's HttpAgent `headers` are STATIC (construction-time), so the
// per-request seam is its `fetch` option: a custom fetch that reads an
// AsyncLocalStorage snapshot (seeded by the POST handler below) and injects the
// inbound x-* (incl. x-aimock-strict / x-test-id / x-diag-*) onto the outbound
// POST. These then arrive on req.headers at the Express endpoint, where the
// agent-side middleware reads them. Byte-identical to a plain fetch when no x-*
// are in scope, so demo traffic proxies unchanged.
const proxyHeaders = new AsyncLocalStorage<Record<string, string>>();

function extractXHeaders(req: NextRequest): Record<string, string> {
  const out: Record<string, string> = {};
  req.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (lower.startsWith("x-")) out[lower] = value;
  });
  return out;
}

const forwardingProxyFetch: NonNullable<HttpAgentConfig["fetch"]> = (
  url,
  requestInit,
) => {
  const forwarded = proxyHeaders.getStore() ?? {};
  if (Object.keys(forwarded).length === 0) return fetch(url, requestInit);
  const merged = new Headers(requestInit?.headers);
  for (const [k, v] of Object.entries(forwarded)) {
    if (!merged.has(k)) merged.set(k, v);
  }
  return fetch(url, { ...requestInit, headers: merged });
};

function createAgent() {
  return new HttpAgent({ url: `${AGENT_URL}/`, fetch: forwardingProxyFetch });
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
  "agentic-chat-reasoning",
  "reasoning-default-render",
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
  // Interrupt demos (Strategy B — frontend-tool async handler)
  "gen-ui-interrupt",
  "interrupt-headless",
];

const agents: Record<string, AbstractAgent> = {};
for (const name of agentNames) {
  agents[name] = createAgent();
}
agents["default"] = createAgent();

console.log(
  `[copilotkit/route] Registered ${Object.keys(agents).length} agent names: ${Object.keys(agents).join(", ")}`,
);

export const POST = async (req: NextRequest) =>
  // Snapshot the inbound x-* into ALS for the duration of the request so the
  // HttpAgent's forwardingProxyFetch can inject them onto the outbound POST to
  // the Express agent. Only headers PRESENT inbound are forwarded — never
  // hardcoded — so non-diagnostic demo traffic is byte-identical.
  proxyHeaders.run(extractXHeaders(req), async () => {
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
      return NextResponse.json(
        { error: err.message, stack: err.stack },
        { status: 500 },
      );
    }
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
      OPENAI_API_KEY: process.env.OPENAI_API_KEY ? "set" : "NOT SET",
      NODE_ENV: process.env.NODE_ENV,
    },
  });
};
