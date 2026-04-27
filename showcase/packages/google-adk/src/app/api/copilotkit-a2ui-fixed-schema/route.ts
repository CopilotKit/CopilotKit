// Dedicated runtime for the A2UI — Fixed Schema demo. Mirrors
// langgraph-python/src/app/api/copilotkit-a2ui-fixed-schema:
// `a2ui.injectA2UITool: false` because the backend agent's `display_flight`
// tool emits its own `a2ui_operations` container — the runtime should not
// auto-inject a `render_a2ui` tool on top.

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

const a2uiFixedSchemaAgent = new HttpAgent({
  url: `${AGENT_URL}/a2ui_fixed_schema`,
});

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
  agents: { "a2ui-fixed-schema": a2uiFixedSchemaAgent },
  a2ui: { injectA2UITool: false },
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
