import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { LangGraphAgent } from "@copilotkit/runtime/langgraph";

// The LangGraph TypeScript agent runs as a separate process on port 8123
// via @langchain/langgraph-cli. This runtime proxies CopilotKit requests
// to it via AG-UI protocol.
const AGENT_URL =
  process.env.LANGGRAPH_DEPLOYMENT_URL || "http://localhost:8123";

console.log("[copilotkit/route] Initializing CopilotKit runtime");
console.log(`[copilotkit/route] AGENT_URL: ${AGENT_URL}`);

function createAgent() {
  return new LangGraphAgent({
    deploymentUrl: `${AGENT_URL}/`,
    graphId: "starterAgent",
  });
}

// Register the same agent under all names used by demo pages.
const agentNames = [
  "agentic_chat",
  "human_in_the_loop",
  "tool-rendering",
  "gen-ui-tool-based",
  "gen-ui-agent",
  "shared-state-read",
  "shared-state-write",
  "shared-state-streaming",
  "subagents",
  // Chat-UI demos — all reuse the default starterAgent.
  "prebuilt-sidebar",
  "prebuilt-popup",
  "chat-customization-css",
  "chat-slots",
];

const agents: Record<string, LangGraphAgent> = {};
for (const name of agentNames) {
  agents[name] = createAgent();
}
agents["default"] = createAgent();
agents["starterAgent"] = createAgent();

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
    const res = await fetch(`${AGENT_URL}/ok`, {
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
