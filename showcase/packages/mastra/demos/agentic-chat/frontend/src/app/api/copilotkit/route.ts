// CopilotKit runtime for the Mastra / Agentic Chat cell.
// Mastra runs in-process via `MastraAgent.getLocalAgents` —
// there is no separate agent server.

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { MastraAgent } from "@ag-ui/mastra";
import { mastra } from "@backend/mastra";

const serviceAdapter = new ExperimentalEmptyAdapter();

function buildAgents() {
  // resourceId is required by the type — demo is stateless, use "".
  const localAgents = MastraAgent.getLocalAgents({ mastra, resourceId: "" });
  const agent = localAgents["agentic_chat"];
  if (!agent) {
    throw new Error("agentic_chat agent missing from Mastra config");
  }
  return { agentic_chat: agent };
}

export const POST = async (req: NextRequest) => {
  try {
    const runtime = new CopilotRuntime({
      // @ts-ignore — single-agent config
      agents: buildAgents(),
    });

    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      runtime,
      serviceAdapter,
      endpoint: "/api/copilotkit",
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
