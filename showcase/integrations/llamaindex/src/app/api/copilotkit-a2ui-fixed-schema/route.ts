// Dedicated runtime for the A2UI Fixed Schema demo.
//
// The backend agent (src/agents/a2ui_fixed.py) emits a pre-authored flight
// schema plus a runtime data model. The A2UI middleware detects the
// `a2ui_operations` container in the tool result and streams rendered
// surfaces to the frontend's fixed catalog.

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { AbstractAgent, HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

const a2uiFixedAgent = new HttpAgent({
  url: `${AGENT_URL}/a2ui-fixed/run`,
});

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
  agents: { "a2ui-fixed-schema": a2uiFixedAgent as AbstractAgent },
  a2ui: {
    // Backend owns the display_flight tool; the runtime must not inject
    // `render_a2ui` on top.
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
