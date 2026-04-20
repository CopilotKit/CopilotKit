import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { LangGraphAgent } from "@copilotkit/runtime/langgraph";

const LANGGRAPH_URL =
  process.env.LANGGRAPH_DEPLOYMENT_URL || "http://localhost:8123";

console.log("[copilotkit/route] Initializing CopilotKit runtime");
console.log(`[copilotkit/route] LANGGRAPH_URL: ${LANGGRAPH_URL}`);
console.log(
  `[copilotkit/route] LANGSMITH_API_KEY: ${process.env.LANGSMITH_API_KEY ? "set" : "not set"}`,
);

function createAgent(graphId: string = "sample_agent") {
  return new LangGraphAgent({
    deploymentUrl: LANGGRAPH_URL,
    graphId,
    langsmithApiKey: process.env.LANGSMITH_API_KEY || "",
  });
}

// Register the same agent under all names used by demo pages.
// Each demo specifies an agent ID; they all route to the same LangGraph graph.
const agentNames = [
  "agentic_chat",
  "frontend_tools",
  "human_in_the_loop",
  "tool-rendering",
  "gen-ui-tool-based",
  "gen-ui-agent",
  "shared-state-read",
  "shared-state-write",
  "shared-state-streaming",
  "subagents",
];

const agents: Record<string, LangGraphAgent> = {};
for (const name of agentNames) {
  agents[name] = createAgent();
}
// Also register a default
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
  } catch (error: any) {
    console.error(`[copilotkit/route] ERROR: ${error.message}`);
    console.error(`[copilotkit/route] Stack: ${error.stack}`);
    return NextResponse.json(
      { error: error.message, stack: error.stack },
      { status: 500 },
    );
  }
};

export const GET = async () => {
  console.log("[copilotkit/route] GET /api/copilotkit (health probe)");

  // Check if LangGraph server is reachable
  let langGraphStatus = "unknown";
  try {
    const res = await fetch(`${LANGGRAPH_URL}/ok`, {
      signal: AbortSignal.timeout(3000),
    });
    langGraphStatus = res.ok ? "reachable" : `error (${res.status})`;
  } catch (e: any) {
    langGraphStatus = `unreachable (${e.message})`;
  }

  return NextResponse.json({
    status: "ok",
    langgraph_url: LANGGRAPH_URL,
    langgraph_status: langGraphStatus,
    env: {
      OPENAI_API_KEY: process.env.OPENAI_API_KEY ? "set" : "NOT SET",
      LANGSMITH_API_KEY: process.env.LANGSMITH_API_KEY ? "set" : "NOT SET",
      NODE_ENV: process.env.NODE_ENV,
    },
  });
};
