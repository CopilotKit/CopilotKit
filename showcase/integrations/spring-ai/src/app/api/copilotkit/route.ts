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
  "agentic-chat-reasoning",
  "reasoning-default-render",
  "tool-rendering-reasoning-chain",
  "mcp-apps",
  "byoc-hashbrown",
];

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
