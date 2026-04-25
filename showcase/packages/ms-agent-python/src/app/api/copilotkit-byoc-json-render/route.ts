/**
 * Dedicated runtime for the BYOC json-render demo.
 *
 * Splitting into its own endpoint keeps the `byoc_json_render` agent
 * isolated from the default multi-agent `/api/copilotkit` runtime. The
 * frontend's demo page (`src/app/demos/byoc-json-render/page.tsx`) points
 * `<CopilotKit runtimeUrl>` here. The agent itself is defined in
 * `src/agents/byoc_json_render_agent.py` and mounted under
 * `/byoc-json-render` in `agent_server.py`.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

const byocJsonRenderAgent = new HttpAgent({
  url: `${AGENT_URL}/byoc-json-render`,
});

const runtime = new CopilotRuntime({
  // @ts-ignore -- same-shape mismatch as the other dedicated routes in this
  // package; the HttpAgent satisfies the runtime's agent interface at
  // runtime but the generics don't line up across the v1/v2 boundary.
  agents: { byoc_json_render: byocJsonRenderAgent },
});

export const POST = async (req: NextRequest) => {
  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit-byoc-json-render",
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
