// Dedicated runtime for the A2UI — Fixed Schema cell (Langroid).
//
// Splitting into its own endpoint lets us set `a2ui.injectA2UITool: false` —
// the backend Langroid agent owns the `display_flight` tool which emits its
// own `a2ui_operations` container directly in the tool result.
//
// References:
// - showcase/integrations/langgraph-python/src/app/api/copilotkit-a2ui-fixed-schema/route.ts
// - showcase/integrations/ag2/src/app/api/copilotkit-a2ui-fixed-schema/route.ts
// - src/agents/a2ui_fixed_agent.py (the Langroid backend)

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

const a2uiFixedSchemaAgent = new HttpAgent({
  url: `${AGENT_URL}/a2ui-fixed-schema`,
});

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
  agents: { "a2ui-fixed-schema": a2uiFixedSchemaAgent },
  a2ui: {
    // The backend agent emits its own `a2ui_operations` container inside
    // the `display_flight` tool result (see src/agents/a2ui_fixed_agent.py).
    // We still run the A2UI middleware so it detects the container in tool
    // results and forwards surfaces to the frontend — but we do NOT inject
    // a runtime `render_a2ui` tool on top of the agent's existing tools.
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
