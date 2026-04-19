// CopilotKit runtime for the Agentic Chat cell.
// Self-contained — one langgraph graph, one agent name.

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { LangGraphAgent } from "@copilotkit/runtime/langgraph";

const LANGGRAPH_URL =
  process.env.LANGGRAPH_DEPLOYMENT_URL || "http://localhost:8123";

const agent = new LangGraphAgent({
  deploymentUrl: `${LANGGRAPH_URL}/`,
  graphId: "starterAgent",
  langsmithApiKey: process.env.LANGSMITH_API_KEY || "",
});

const runtime = new CopilotRuntime({
  // @ts-ignore — single-agent config
  agents: { agentic_chat: agent },
});

export const POST = async (req: NextRequest) => {
  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit",
      serviceAdapter: new ExperimentalEmptyAdapter(),
      runtime,
    });
    return await handleRequest(req);
  } catch (error: unknown) {
    const e = error as { message?: string; stack?: string };
    return NextResponse.json(
      { error: e.message, stack: e.stack },
      { status: 500 },
    );
  }
};
