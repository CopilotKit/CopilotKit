// Dedicated runtime for the A2UI — Fixed Schema cell. Splitting into its own
// endpoint (mirroring the LangGraph reference) lets us set
// `a2ui.injectA2UITool: false` — the backend .NET agent owns the
// `search_flights` tool which emits its own `a2ui_operations` container.
//
// The .NET backend exposes this agent at `AGENT_URL/a2ui-fixed-schema`
// (see agent/Program.cs).

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
    // The backend emits its own `a2ui_operations` container via the
    // `search_flights` tool. We still run the A2UI middleware so it detects
    // the container in tool results and forwards surfaces to the frontend —
    // but we do NOT inject a runtime `render_a2ui` tool on top of the
    // agent's existing tools.
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
