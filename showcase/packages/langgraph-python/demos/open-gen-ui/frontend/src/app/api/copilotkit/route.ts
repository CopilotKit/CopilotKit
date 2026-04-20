// CopilotKit runtime for the minimal Open-Ended Generative UI cell.
//
// The only thing that enables Open Generative UI is `openGenerativeUI`
// on the runtime. That installs the middleware which turns streamed
// `generateSandboxedUi` tool calls from the agent into
// `open-generative-ui` activity events for the built-in renderer.

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

// @region[minimal-runtime-flag]
const runtime = new CopilotRuntime({
  // @ts-ignore
  agents: { "open-gen-ui": agent },
  // One flag turns on Open Generative UI for the listed agent(s). The
  // runtime middleware converts the agent's streamed `generateSandboxedUi`
  // tool call into `open-generative-ui` activity events.
  openGenerativeUI: { agents: ["open-gen-ui"] },
});
// @endregion[minimal-runtime-flag]

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
