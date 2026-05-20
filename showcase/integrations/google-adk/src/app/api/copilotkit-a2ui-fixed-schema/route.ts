// Dedicated runtime for the A2UI — Fixed Schema cell. Splitting into its
// own endpoint lets us set `a2ui.injectA2UITool: false` — the backend ADK
// agent owns the `display_flight` tool which emits its own
// `a2ui_operations` container directly in the tool result.
//
// Reference:
// - showcase/integrations/langgraph-python/src/app/api/copilotkit-a2ui-fixed-schema/route.ts
// - src/agents/a2ui_fixed_agent.py (the ADK backend)

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
  // @ts-expect-error -- Published CopilotRuntime agents type wraps Record in
  // MaybePromise<NonEmptyRecord<...>> which rejects plain Records;
  // fixed in source, pending release.
  agents: { "a2ui-fixed-schema": a2uiFixedSchemaAgent },
  a2ui: {
    // The backend agent emits its own `a2ui_operations` container inside
    // `display_flight` (see src/agents/a2ui_fixed_agent.py). We still run
    // the A2UI middleware so it detects the container in tool results and
    // forwards surfaces to the frontend — but we do NOT inject a runtime
    // `render_a2ui` tool on top of the agent's existing tools.
    injectA2UITool: false,
  },
});

const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
  endpoint: "/api/copilotkit-a2ui-fixed-schema",
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
