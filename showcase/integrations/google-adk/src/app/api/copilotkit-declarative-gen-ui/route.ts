// Dedicated runtime for the Declarative Generative UI (A2UI — Dynamic Schema)
// demo. Mirrors langgraph-python/src/app/api/copilotkit-declarative-gen-ui:
// `a2ui.injectA2UITool: false` because the backend ADK agent owns the
// `generate_a2ui` tool itself (see src/agents/declarative_gen_ui_agent.py
// and src/agents/main.py for the implementation). Double-binding from the
// runtime would duplicate the tool slot and confuse the LLM.
//
// The A2UI middleware still runs — it serialises the registered client
// catalog into the agent's `copilotkit.context` so the secondary LLM inside
// `generate_a2ui` knows which components to emit, and detects the
// `a2ui_operations` container in the tool result for client-side rendering.

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

const declarativeGenUiAgent = new HttpAgent({
  url: `${AGENT_URL}/declarative_gen_ui`,
});

const runtime = new CopilotRuntime({
  // @ts-expect-error -- see main route.ts
  agents: { "declarative-gen-ui": declarativeGenUiAgent },
  a2ui: { injectA2UITool: false },
});

const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
  endpoint: "/api/copilotkit-declarative-gen-ui",
  serviceAdapter: new ExperimentalEmptyAdapter(),
  runtime,
});

export const POST = async (req: NextRequest) => {
  try {
    return await handleRequest(req);
  } catch (error: unknown) {
    const e = error as { message?: string; stack?: string };
    return NextResponse.json(
      { error: e.message, stack: e.stack },
      { status: 500 },
    );
  }
};
