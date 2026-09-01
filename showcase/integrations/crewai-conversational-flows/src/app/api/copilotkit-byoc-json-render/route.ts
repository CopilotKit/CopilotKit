/**
 * Dedicated runtime for the BYOC json-render demo.
 *
 * Splitting into its own endpoint keeps the `byoc_json_render` crew
 * isolated from the default multi-agent `/api/copilotkit` runtime. The
 * frontend's demo page points `<CopilotKit runtimeUrl>` here.
 *
 * Agent URL targets the dedicated `/byoc-json-render` FastAPI endpoint
 * mounted by `agent_server.py`.
 */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import type { AbstractAgent } from "@ag-ui/client";
import { HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

function createAgent() {
  return new HttpAgent({
    url: `${AGENT_URL}/conversational_flows/byoc-json-render`,
  });
}

const agents: Record<string, AbstractAgent> = {
  byoc_json_render: createAgent(),
  default: createAgent(),
};

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
  agents,
});

export const POST = async (req: NextRequest) => {
  try {
    const copilotHandler = createCopilotRuntimeHandler({
      runtime,
      basePath: "/api/copilotkit-byoc-json-render",
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
