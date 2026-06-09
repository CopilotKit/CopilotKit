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

function createAgent(path = "/") {
  return new HttpAgent({ url: `${AGENT_URL}${path}` });
}

// CrewAI hosts a single shared `LatestAiDevelopment` crew. We register
// many agent names here so individual demo pages can scope their
// per-cell frontend tool / component registrations independently; all
// names resolve to the same HttpAgent bridge. See PARITY_NOTES.md.
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
  // Newly ported in parity PR — chrome / headless
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
  "tool-rendering-custom-catchall",
  "tool-rendering-reasoning-chain",
  // HITL
  "hitl-in-chat",
  "hitl-in-app",
  // Open-ended generative UI
  "open-gen-ui",
  "open-gen-ui-advanced",
];

// Reasoning agent names — backed by the reasoning-enabled custom sub-app at
// /reasoning. It emits AG-UI REASONING_MESSAGE_* events that the frontend
// renders via the `reasoningMessage` slot (built-in card for
// `reasoning-default`, custom amber ReasoningBlock for `reasoning-custom`).
// The shared LatestAiDevelopment crew on "/" cannot host these demos because
// its litellm adapter drops the model's reasoning_content channel and emits
// no REASONING_MESSAGE_* events. The demo pages use the ids
// `reasoning-default` / `reasoning-custom`; both share the one reasoning
// backend. `agentic-chat-reasoning` and `reasoning-default-render` are legacy
// aliases kept for any cell that still references them.
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
// Interrupt-adapted demos route to the dedicated scheduling crew backend.
// Both gen-ui-interrupt and interrupt-headless share the same crew; only the
// frontend UX differs (inline in chat vs. external popup).
agents["gen-ui-interrupt"] = createAgent("/interrupt-adapted");
agents["interrupt-headless"] = createAgent("/interrupt-adapted");
// gen-ui-agent routes to a dedicated CrewAI Flow backend that owns the
// `set_steps` tool + per-call STATE_SNAPSHOT emit (see
// src/agents/gen_ui_agent.py). The shared LatestAiDevelopment crew on "/"
// cannot host this demo because ChatWithCrewFlow does not surface
// per-tool state mutations to the AG-UI bridge — same architectural
// reason as shared-state-read-write and subagents.
agents["gen-ui-agent"] = createAgent("/gen-ui-agent");
agents["default"] = createAgent();

console.log(
  `[copilotkit/route] Registered ${Object.keys(agents).length} agent names: ${Object.keys(agents).join(", ")}`,
);

export const POST = async (req: NextRequest) => {
  const url = req.url;
  const contentType = req.headers.get("content-type");
  console.log(`[copilotkit/route] POST ${url} (content-type: ${contentType})`);

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
    console.log(`[copilotkit/route] Response status: ${response.status}`);
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
  console.log("[copilotkit/route] GET /api/copilotkit (health probe)");

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
