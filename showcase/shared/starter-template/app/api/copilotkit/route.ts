import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
  CopilotKitIntelligence,
} from "@copilotkit/runtime";
import { LangGraphAgent } from "@copilotkit/runtime/langgraph";

const AGENT_URL =
  process.env.AGENT_URL ||
  process.env.LANGGRAPH_DEPLOYMENT_URL ||
  "http://localhost:8123";

if (!process.env.AGENT_URL && !process.env.LANGGRAPH_DEPLOYMENT_URL) {
  console.warn(
    "[copilotkit/route] WARNING: No AGENT_URL or LANGGRAPH_DEPLOYMENT_URL set, falling back to localhost:8123",
  );
}

const intelligenceApiUrl = process.env.INTELLIGENCE_API_URL;
const intelligenceWsUrl = process.env.INTELLIGENCE_GATEWAY_WS_URL;
const intelligenceApiKey = process.env.INTELLIGENCE_API_KEY;

const intelligenceEnabled = Boolean(
  intelligenceApiUrl && intelligenceWsUrl && intelligenceApiKey,
);

console.log("[copilotkit/route] Initializing CopilotKit runtime");
console.log(`[copilotkit/route] AGENT_URL: ${AGENT_URL}`);
console.log(
  `[copilotkit/route] Intelligence mode: ${
    intelligenceEnabled ? "enabled" : "disabled (OSS)"
  }`,
);

function createAgent(graphId: string = "sample_agent") {
  return new LangGraphAgent({
    deploymentUrl: AGENT_URL,
    graphId,
    langsmithApiKey: process.env.LANGSMITH_API_KEY || "",
  });
}

const agentNames = [
  "sample_agent",
  "agentic_chat",
  "human_in_the_loop",
  "tool-rendering",
  "gen-ui-tool-based",
  "gen-ui-agent",
  "shared-state-read",
  "shared-state-write",
  "shared-state-streaming",
  "subagents",
  "default",
];

const agents: Record<string, LangGraphAgent> = {};
for (const name of agentNames) {
  agents[name] = createAgent();
}

export const POST = async (req: NextRequest) => {
  try {
    // Conditionally instantiate CopilotKitIntelligence when all env vars are present
    const intelligence = intelligenceEnabled
      ? new CopilotKitIntelligence({
          apiUrl: intelligenceApiUrl!,
          wsUrl: intelligenceWsUrl!,
          apiKey: intelligenceApiKey!,
        })
      : undefined;

    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit",
      serviceAdapter: new ExperimentalEmptyAdapter(),
      runtime: new CopilotRuntime({
        // @ts-expect-error -- type wrapping mismatch, fixed in source pending release
        agents,
        ...(intelligence ? { intelligence } : {}),
      }),
    });

    return await handleRequest(req);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[copilotkit/route] ERROR:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
};

export const GET = async () => {
  let agentStatus = "unknown";
  try {
    const res = await fetch(`${AGENT_URL}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    agentStatus = res.ok ? "reachable" : `error (${res.status})`;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    agentStatus = `unreachable (${msg})`;
  }

  const topStatus = agentStatus.startsWith("unreachable") ? "degraded" : "ok";

  return NextResponse.json({
    status: topStatus,
    agent_url: AGENT_URL,
    agent_status: agentStatus,
    env: {
      OPENAI_API_KEY: process.env.OPENAI_API_KEY ? "set" : "NOT SET",
      NODE_ENV: process.env.NODE_ENV,
    },
  });
};
