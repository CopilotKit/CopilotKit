// Dedicated runtime for the Declarative Generative UI (A2UI — Dynamic Schema)
// cell. Splitting into its own endpoint (mirroring beautiful-chat) lets us set
// `a2ui.injectA2UITool: false` — the backend agent owns the `generate_a2ui`
// tool itself, so double-binding from the runtime would duplicate the tool
// slot and confuse the LLM.
//
// Reference:
// - src/app/api/copilotkit/route.ts (LF main runtime)
// - src/agents/src/a2ui_dynamic.py (the backend graph)

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { LangGraphAgent } from "@copilotkit/runtime/langgraph";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8123";

const declarativeGenUiAgent = new LangGraphAgent({
  deploymentUrl: `${AGENT_URL}/`,
  graphId: "a2ui_dynamic",
});

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
  agents: { "declarative-gen-ui": declarativeGenUiAgent },
  a2ui: {
    // The backend graph owns the `generate_a2ui` tool explicitly (see
    // src/agents/src/a2ui_dynamic.py), so the runtime MUST NOT auto-inject its
    // own A2UI tool on top. The A2UI middleware still runs — it serialises
    // the registered client catalog into the agent's `copilotkit.context` so
    // the secondary LLM inside `generate_a2ui` knows which components to emit
    // — and it still detects the `a2ui_operations` container in the tool
    // result and streams rendered surfaces to the frontend.
    injectA2UITool: false,
  },
});

export const POST = async (req: NextRequest) => {
  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit-declarative-gen-ui",
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
