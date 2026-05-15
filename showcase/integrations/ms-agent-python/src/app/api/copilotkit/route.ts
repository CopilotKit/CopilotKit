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

function createInterruptAgent() {
  return new HttpAgent({ url: `${AGENT_URL}/interrupt-adapted` });
}

// Register the same agent under all names used by demo pages.
const agentNames = [
  "agentic_chat",
  "human_in_the_loop",
  "tool-rendering",
  "gen-ui-agent",
  "shared-state-read",
  "shared-state-write",
  "shared-state-streaming",
  "prebuilt-sidebar",
  "prebuilt-popup",
  "chat-slots",
  "chat-customization-css",
  "headless-simple",
  "headless-complete",
  "frontend-tools",
  "frontend-tools-async",
  "readonly-state-agent-context",
];

// Agent names routed to the interrupt-adapted scheduling backend. Both
// gen-ui-interrupt and interrupt-headless share the same MS Agent Framework
// scheduling agent; only the frontend UX differs (inline in chat vs. external
// popup driven from a button grid).
const interruptAgentNames = ["gen-ui-interrupt", "interrupt-headless"];

const agents: Record<string, AbstractAgent> = {};
for (const name of agentNames) {
  agents[name] = createAgent();
}

// Interrupt-adapted demos — frontend-tool shim for LangGraph `interrupt()`.
// Both gen-ui-interrupt and interrupt-headless share the same scheduling agent;
// only the frontend UX differs (inline time-picker vs. external popup).
for (const name of interruptAgentNames) {
  agents[name] = createInterruptAgent();
}
// In-App HITL -- async frontend-tool + app-level modal (outside chat).
// Dedicated hitl-in-app agent mounted at /hitl-in-app on the FastAPI
// backend; agent has tools=[] and relies on the frontend-provided
// `request_user_approval` tool injected by CopilotKit at request time.
agents["hitl-in-app"] = createAgent("/hitl-in-app");

// In-Chat HITL -- frontend-defined `book_call` tool rendered inline in the
// chat via `useHumanInTheLoop`. Backend agent has tools=[] and routes to
// /hitl-in-chat on the FastAPI backend. The booking-flow alias
// (`hitl-in-chat-booking`) reuses the same backend.
agents["hitl-in-chat"] = createAgent("/hitl-in-chat");
agents["hitl-in-chat-booking"] = createAgent("/hitl-in-chat");

// Tool-Based Generative UI -- frontend registers `render_bar_chart` and
// `render_pie_chart` via `useComponent`; backend agent has tools=[] and a
// system prompt that picks the right chart type for the user's request.
agents["gen-ui-tool-based"] = createAgent("/gen-ui-tool-based");

// Shared State (Read + Write) — bidirectional state via state_schema +
// state_update. Backend exposes a dedicated agent at /shared-state-read-write
// with `preferences` + `notes` slots; UI writes preferences via setState,
// agent writes notes via the `set_notes` tool.
agents["shared-state-read-write"] = createAgent("/shared-state-read-write");

// Sub-Agents — supervisor agent at /subagents that delegates to research /
// writing / critique sub-agents and surfaces a live `delegations` log to the
// UI via shared state.
agents["subagents"] = createAgent("/subagents");

agents["default"] = createAgent();

// Tool-rendering demos — share the dedicated reasoning-chain agent
// mounted at /tool-rendering-reasoning-chain on the Python backend. All
// three cells call the same agent; they differ only in how the frontend
// renders tool calls.
agents["tool-rendering-default-catchall"] = createAgent(
  "/tool-rendering-reasoning-chain",
);
agents["tool-rendering-custom-catchall"] = createAgent(
  "/tool-rendering-reasoning-chain",
);
agents["tool-rendering-reasoning-chain"] = createAgent(
  "/tool-rendering-reasoning-chain",
);

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
