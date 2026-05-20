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

function createMainAgent() {
  return new HttpAgent({ url: `${AGENT_URL}/agui` });
}

function createReasoningAgent() {
  return new HttpAgent({ url: `${AGENT_URL}/reasoning/agui` });
}

// State-aware agents are served by a custom AGUI handler in agent_server.py
// that emits StateSnapshotEvent after every run. Stock Agno AGUI does NOT
// emit state events, so demos that depend on agent-side state writes
// (set_notes, delegations) must point at these dedicated routes.
function createSharedStateRWAgent() {
  return new HttpAgent({ url: `${AGENT_URL}/shared-state-rw/agui` });
}

function createSubagentsAgent() {
  return new HttpAgent({ url: `${AGENT_URL}/subagents/agui` });
}

// Main agent backs most demos. The Next.js runtime aliases the single
// Agno `main` agent under every demo cell name so per-cell frontend
// tool/component registrations scope correctly.
const mainAgentNames = [
  "agentic_chat",
  "human_in_the_loop",
  "hitl-in-chat",
  "hitl-in-app",
  "tool-rendering",
  "tool-rendering-default-catchall",
  "tool-rendering-custom-catchall",
  "gen-ui-tool-based",
  "gen-ui-agent",
  "shared-state-read",
  "shared-state-write",
  "shared-state-streaming",
  // Neutral / chrome demos reusing the default agent.
  "prebuilt-sidebar",
  "prebuilt-popup",
  "chat-slots",
  "chat-customization-css",
  "headless-simple",
  "headless-complete",
  "frontend_tools",
  "frontend-tools-async",
  "readonly-state-agent-context",
  "agent-config",
];

// Interrupt-adapted demos: gen-ui-interrupt and interrupt-headless share
// the same Agno scheduling agent at /interrupt-adapted/agui. The agent has
// tools=[]; `schedule_meeting` is provided by the frontend via
// `useFrontendTool` with an async Promise handler.
function createInterruptAgent() {
  return new HttpAgent({ url: `${AGENT_URL}/interrupt-adapted/agui` });
}

const interruptAgentNames = ["gen-ui-interrupt", "interrupt-headless"];

// Reasoning agent names — backed by the reasoning-enabled Agno agent at
// /reasoning/agui. Emits AG-UI REASONING_MESSAGE_* events that the
// frontend renders via CopilotChatReasoningMessage (or a custom slot).
const reasoningAgentNames = [
  "agentic-chat-reasoning",
  "reasoning-default-render",
  "tool-rendering-reasoning-chain",
];

const agents: Record<string, AbstractAgent> = {};
for (const name of mainAgentNames) {
  agents[name] = createMainAgent();
}
for (const name of interruptAgentNames) {
  agents[name] = createInterruptAgent();
}
for (const name of reasoningAgentNames) {
  agents[name] = createReasoningAgent();
}
// Bidirectional shared-state agent — UI writes preferences, agent writes
// notes back via set_notes and the custom AGUI router emits a
// StateSnapshotEvent that the frontend's useAgent picks up.
agents["shared-state-read-write"] = createSharedStateRWAgent();
// Sub-agents supervisor — appends to state["delegations"] every time a
// research / writing / critique sub-agent is delegated to. Same custom
// AGUI router emits the StateSnapshotEvent needed for the live log.
agents["subagents"] = createSubagentsAgent();
agents["default"] = createMainAgent();

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
