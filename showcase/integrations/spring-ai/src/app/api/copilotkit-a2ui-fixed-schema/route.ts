// Dedicated runtime for the A2UI Fixed Schema demo.
//
// Routes to the Spring /a2ui-fixed-schema/run endpoint, which registers a
// single display_flight tool that emits the fixed flight-card schema and
// data model. The frontend catalog (see src/app/demos/a2ui-fixed-schema/a2ui/)
// pins the Title, Airport, Arrow, AirlineBadge, PriceTag, and Button
// components to React renderers.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import type { AbstractAgent } from "@ag-ui/client";
import { HttpAgent } from "@ag-ui/client";

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
    const copilotHandler = createCopilotRuntimeHandler({
      runtime,
      basePath: "/api/copilotkit-a2ui-fixed-schema",
      mode: "single-route",
    });
    return await copilotHandler(req);
  } catch (error: unknown) {
    const e = error as { message?: string; stack?: string };
    return NextResponse.json(
      { error: e.message, stack: e.stack },
      { status: 500 },
    );
  }
};
