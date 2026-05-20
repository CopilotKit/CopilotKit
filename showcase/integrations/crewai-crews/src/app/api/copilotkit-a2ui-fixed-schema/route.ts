// Dedicated runtime for the A2UI Fixed-Schema cell.
//
// `injectA2UITool: false` because the backend crew owns a `display_flight`
// tool that emits its own `a2ui_operations` container referencing the
// pre-authored schema in `src/agents/a2ui_schemas/flight_schema.json`.
// The A2UI middleware still runs and serialises frames to the frontend.
//
// Agent URL points at the dedicated `/a2ui-fixed-schema` FastAPI endpoint
// mounted by `agent_server.py`.

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { AbstractAgent, HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

function createAgent() {
  return new HttpAgent({ url: `${AGENT_URL}/a2ui-fixed-schema` });
}

const agents: Record<string, AbstractAgent> = {
  "a2ui-fixed-schema": createAgent(),
  default: createAgent(),
};

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
  agents,
  a2ui: {
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
