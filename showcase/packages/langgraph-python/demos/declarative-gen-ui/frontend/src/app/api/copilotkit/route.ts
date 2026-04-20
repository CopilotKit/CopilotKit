// CopilotKit runtime for the Declarative Gen-UI (A2UI) cell.
//
// Canonical Bring-Your-Own-Catalog (BYOC) setup: the frontend registers
// `myCatalog` via `<CopilotKit a2ui={{ catalog }}>` (see `../../page.tsx`),
// and this runtime flips `a2ui.injectA2UITool: true` so the A2UI middleware
// auto-injects the `render_a2ui` tool + the catalog schema into the agent.
// The backend agent (`backend/agent.py`) stays minimal — no tools, no
// secondary LLM.
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

// @region[runtime-inject-tool]
const runtime = new CopilotRuntime({
  // @ts-ignore
  agents: { "declarative-gen-ui": agent },
  // injectA2UITool wires the A2UI middleware and adds `render_a2ui` +
  // usage guidelines to the agent's tool list. The middleware also
  // serialises the registered client catalog (see `../../a2ui/renderers`)
  // into the agent's `copilotkit.context` so the LLM knows which
  // components + props are available.
  a2ui: {
    injectA2UITool: true,
    agents: ["declarative-gen-ui"],
  },
});
// @endregion[runtime-inject-tool]

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
