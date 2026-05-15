// Dedicated runtime for the Declarative Generative UI (A2UI — Dynamic Schema)
// cell. Splitting into its own endpoint (mirroring beautiful-chat) lets us set
// `a2ui.injectA2UITool: false` — the backend PydanticAI agent owns the
// `generate_a2ui` tool itself, so double-binding from the runtime would
// duplicate the tool slot and confuse the LLM.
//
// Mirrors showcase/integrations/langgraph-python/src/app/api/copilotkit-declarative-gen-ui/route.ts.

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

const declarativeGenUiAgent = new HttpAgent({
  url: `${AGENT_URL}/a2ui_dynamic/`,
});

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
  agents: { "declarative-gen-ui": declarativeGenUiAgent },
  a2ui: {
    // The backend PydanticAI agent owns the `generate_a2ui` tool
    // explicitly (see src/agents/a2ui_dynamic.py). The A2UI middleware
    // still runs — it serialises the registered client catalog into the
    // agent's `copilotkit.context` so the secondary LLM inside
    // `generate_a2ui` knows which components are available — and it
    // still detects the `a2ui_operations` container in the tool result
    // and streams rendered surfaces to the frontend.
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
