// Dedicated runtime for the A2UI Fixed Schema demo.
//
// Routes to the Spring /a2ui-fixed-schema/run endpoint, which registers a
// single display_flight tool that emits the fixed flight-card schema and
// data model. The frontend catalog (see src/app/demos/a2ui-fixed-schema/a2ui/)
// pins the Title, Airport, Arrow, AirlineBadge, PriceTag, and Button
// components to React renderers.

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { AbstractAgent, HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

function createAgent(): AbstractAgent {
  return new HttpAgent({ url: `${AGENT_URL}/a2ui-fixed-schema/run` });
}

const agents: Record<string, AbstractAgent> = {
  "a2ui-fixed-schema": createAgent(),
};

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
  agents,
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
