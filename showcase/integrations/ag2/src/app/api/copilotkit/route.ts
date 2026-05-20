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
  "gen-ui-agent",
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
  "reasoning-default-render",
  "tool-rendering-default-catchall",
  "tool-rendering-custom-catchall",
  "frontend_tools",
  "frontend-tools-async",
  "hitl-in-app",
  "hitl-in-chat",
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
};

// Interrupt-adapted demos: gen-ui-interrupt and interrupt-headless share the
// same AG2 scheduling agent at /interrupt-adapted. The agent has tools=[];
// `schedule_meeting` is provided by the frontend via `useFrontendTool`.
const interruptAgentNames = ["gen-ui-interrupt", "interrupt-headless"];

const agents: Record<string, AbstractAgent> = {};
for (const name of sharedAgentNames) {
  agents[name] = createAgent();
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
