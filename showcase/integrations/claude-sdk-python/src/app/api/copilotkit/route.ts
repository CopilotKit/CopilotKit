import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { AbstractAgent, HttpAgent } from "@ag-ui/client";
import crypto from "node:crypto";

// The agent backend runs as a separate process on port 8000.
// This runtime proxies CopilotKit requests to it via AG-UI protocol.
const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

console.log("[copilotkit/route] Initializing CopilotKit runtime");
console.log(`[copilotkit/route] AGENT_URL: ${AGENT_URL}`);

function createAgent(path = "/") {
  return new HttpAgent({ url: `${AGENT_URL}${path}` });
}

// Register the same agent under all names used by demo pages.
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
  "shared-state-streaming",
  "prebuilt-sidebar",
  "prebuilt-popup",
  "chat-slots",
  "chat-customization-css",
  "headless-simple",
  "frontend-tools",
  "frontend-tools-async",
  "hitl-in-app",
  "readonly-state-agent-context",
  "headless-complete",
  "beautiful-chat",
];

// Demos with dedicated FastAPI endpoints (their own state schema, tool
// set, or prompt). The Python backend mounts each at /<name>; mapping
// the agent name to that path keeps the runtime config flat.
const dedicatedAgentPaths: Record<string, string> = {
  "shared-state-read-write": "/shared-state-read-write",
  subagents: "/subagents",
  // Reasoning demos share a single backend that emits AG-UI
  // REASONING_MESSAGE_* events (parsed out of <reasoning>...</reasoning>
  // blocks the model emits). The two demo cells differ only on the
  // frontend slot configuration.
  "agentic-chat-reasoning": "/reasoning",
  "reasoning-default-render": "/reasoning",
  "tool-rendering-reasoning-chain": "/tool-rendering-reasoning-chain",
  "hitl-in-chat": "/hitl-in-chat",
  "hitl-in-chat-booking": "/hitl-in-chat",
  "gen-ui-interrupt": "/interrupt-adapted",
  "interrupt-headless": "/interrupt-adapted",
};

const agents: Record<string, AbstractAgent> = {};
for (const name of agentNames) {
  agents[name] = createAgent();
}
for (const [name, path] of Object.entries(dedicatedAgentPaths)) {
  agents[name] = createAgent(path);
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
    // Log the full error server-side with a correlation id, but only return
    // a generic message + errorId to the client so we don't leak stack
    // traces or internal error messages to untrusted callers. Mirrors the
    // pattern used in `mastra/src/app/api/copilotkit/route.ts`.
    const err = error instanceof Error ? error : new Error(String(error));
    const errorId = crypto.randomUUID();
    console.error(
      JSON.stringify({
        at: new Date().toISOString(),
        level: "error",
        route: "/api/copilotkit",
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
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ? "set" : "NOT SET",
      NODE_ENV: process.env.NODE_ENV,
    },
  });
};
