import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { AbstractAgent, HttpAgent } from "@ag-ui/client";

// The Spring AI agent backend runs as a separate Java process.
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

// Register the same Spring AI agent (backed by a single Spring-AI ChatClient
// on the Java side) under every name used by the demo pages in this package.
// Each entry proxies CopilotKit requests to the same Spring endpoint —
// per-demo behavior differences live on the frontend in the form of
// useFrontendTool / useRenderTool / useHumanInTheLoop / useAgentContext
// hooks registered on each page.
const agentNames = [
  "agentic_chat",
  "human_in_the_loop",
  "tool-rendering",
  "tool-rendering-default-catchall",
  "tool-rendering-custom-catchall",
  "gen-ui-tool-based",
  "gen-ui-agent",
  "shared-state-read",
  "shared-state-write",
  "shared-state-read-write",
  "shared-state-streaming",
  "subagents",
  "chat-customization-css",
  "frontend_tools",
  "frontend-tools-async",
  "hitl-in-chat",
  "hitl-in-app",
  "prebuilt-sidebar",
  "prebuilt-popup",
  "chat-slots",
  "headless-simple",
  "headless-complete",
  "readonly-state-agent-context",
  "auth",
  "open-gen-ui",
  "beautiful-chat",
  // NOTE: `tool-rendering-reasoning-chain` is intentionally NOT registered
  // here. It is declared NSF in manifest.yaml (no parallel multi-tool-call
  // streaming surface to interleave with reasoning frames on spring-ai), and
  // routing it to the default Spring agent at `/` silently bypassed the
  // reasoning workaround and rendered a regular tool-rendering run, hiding
  // the NSF. With no registration the page errors loudly when probed —
  // appropriate for a not-supported feature.
  "mcp-apps",
  "byoc-hashbrown",
];

// Reasoning agent names — backed by the dedicated Spring-AI reasoning
// controller at /reasoning (ReasoningController). The AG-UI Java SDK at
// Spring AI 1.0.1 has no REASONING_MESSAGE_* subtypes in its typed event
// model (the SDK only knows THINKING_*, which @ag-ui/client silently drops),
// so ReasoningController takes over its own SseEmitter and writes raw-JSON
// REASONING_MESSAGE_START/CONTENT/END frames whose `type` literal matches
// the @ag-ui/core zod schema — the frontend then renders them via the
// `reasoningMessage` slot: CopilotKit's built-in card for
// `reasoning-default`, the custom amber ReasoningBlock for
// `reasoning-custom`. This is the Spring/Java reimplementation of ag2's
// reasoning_agent.py. The demo pages use the ids `reasoning-default` /
// `reasoning-custom`; both share the one reasoning backend.
// Mirrors ag2's route.ts `reasoningAgentNames`. NOTE:
// `tool-rendering-reasoning-chain`, `reasoning-default-render`, and
// `agentic-chat-reasoning` are NOT listed here — they are declared NSF in
// manifest.yaml (no parallel multi-tool-call streaming surface to interleave
// with reasoning frames on spring-ai for tool-rendering-reasoning-chain; no
// matching backend surface for the other two). With no registration the
// pages error loudly when probed — appropriate for not-supported features.
const reasoningAgentNames = ["reasoning-default", "reasoning-custom"];

// Agent names routed to the interrupt-adapted scheduling backend. Both
// gen-ui-interrupt and interrupt-headless share the same Spring AI scheduling
// agent; only the frontend UX differs (inline picker in chat vs. external
// popup driven by useFrontendTool).
const interruptAgentNames = ["gen-ui-interrupt", "interrupt-headless"];

const agents: Record<string, AbstractAgent> = {};
for (const name of agentNames) {
  agents[name] = createAgent();
}
for (const name of interruptAgentNames) {
  agents[name] = createAgent("/interrupt-adapted");
}
for (const name of reasoningAgentNames) {
  agents[name] = createAgent("/reasoning/");
}
// gen-ui-agent has a dedicated Java controller (GenUiAgentController @ /gen-ui-agent/run)
// that drives the set_steps state-card chain; override the shared-root registration.
agents["gen-ui-agent"] = createAgent("/gen-ui-agent/run");
// subagents likewise has a dedicated Java controller (SubagentsController @
// /subagents/run) that emits the research/writing/critique sub-agent
// TOOL_CALL chains the subagent cards render from. The shared-root
// registration above routed it to the default StreamingToolAgent, which has
// no research_agent/writing_agent/critique_agent tools — the run produced a
// final summary but zero subagent cards. Override to the dedicated controller.
agents["subagents"] = createAgent("/subagents/run");
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
