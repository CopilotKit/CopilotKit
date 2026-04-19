// CopilotKit runtime for the Declarative Gen-UI (A2UI) primary cell.
//
// Canonical "injectA2UITool only" setup — no custom catalog on the frontend,
// so the agent generates A2UI surfaces against the built-in basic catalog.
//
// Reference:
//   https://docs.copilotkit.ai/integrations/langgraph/generative-ui/a2ui

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

const runtime = new CopilotRuntime({
  // @ts-ignore
  agents: { "declarative-gen-ui": agent },
  // injectA2UITool wires the A2UI middleware and adds `render_a2ui` +
  // usage guidelines to the agent's tool list. With no custom catalog on
  // the frontend, the middleware injects the basic-catalog schema as
  // `copilotkit.context` so the LLM knows what it can render.
  a2ui: {
    injectA2UITool: true,
    agents: ["declarative-gen-ui"],
  },
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
