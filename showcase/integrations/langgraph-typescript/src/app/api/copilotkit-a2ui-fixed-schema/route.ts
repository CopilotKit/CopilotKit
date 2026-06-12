// Dedicated runtime for the A2UI — Fixed Schema cell. Splitting into its own
// endpoint lets us set `a2ui.injectA2UITool: false` — the backend agent owns
// the `display_flight` tool which emits its own `a2ui_operations` container.

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { LangGraphAgent } from "@copilotkit/runtime/langgraph";

const LANGGRAPH_URL =
  process.env.LANGGRAPH_DEPLOYMENT_URL || "http://localhost:8123";

const a2uiFixedSchemaAgent = new LangGraphAgent({
  deploymentUrl: `${LANGGRAPH_URL}/`,
  graphId: "a2ui_fixed",
  langsmithApiKey: process.env.LANGSMITH_API_KEY || "",
});

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
  agents: { "a2ui-fixed-schema": a2uiFixedSchemaAgent },
  a2ui: {
    // The backend emits its own `a2ui_operations` container via `display_flight`
    // (see src/agent/a2ui-fixed.ts). We still run the A2UI middleware so it
    // detects the container in tool results and forwards surfaces to the
    // frontend — but we do NOT inject a runtime `render_a2ui` tool on top.
    injectA2UITool: false,
  },
});

export const POST = async (req: NextRequest) => {
  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit-a2ui-fixed-schema",
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
