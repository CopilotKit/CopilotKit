// CopilotKit runtime for the Open-Ended Generative UI cell.

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
  deploymentUrl: LANGGRAPH_URL,
  graphId: "agent",
  langsmithApiKey: process.env.LANGSMITH_API_KEY || "",
});

// @region[advanced-runtime-config]
// Server-side config is identical to the minimal cell — the advanced
// behaviour (sandbox -> host function calls) is wired entirely on the
// frontend via `openGenerativeUI.sandboxFunctions` on the provider.
const runtime = new CopilotRuntime({
  // @ts-ignore
  agents: { "open-gen-ui-advanced": agent },
  openGenerativeUI: { agents: ["open-gen-ui-advanced"] },
});
// @endregion[advanced-runtime-config]

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
