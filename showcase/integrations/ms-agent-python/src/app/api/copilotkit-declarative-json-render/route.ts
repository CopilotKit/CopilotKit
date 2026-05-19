// Dedicated runtime for the declarative-json-render demo.
//
// The demo page (`src/app/demos/declarative-json-render/page.tsx`) swaps
// in `JsonRenderAssistantMessage` and renders an agent-emitted JSON spec
// via `@json-render/react` against a Zod-validated catalog (MetricCard,
// BarChart, PieChart). The MS Agent behind this endpoint (see
// `src/agents/byoc_json_render_agent.py`, mounted at `/byoc-json-render`
// in `agent_server.py`) emits that JSON envelope. The legacy
// `byoc_json_render` Python module name is retained (matches LGP's
// convention); only the slug, route, and frontend folder use the
// `declarative-` prefix.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

const declarativeJsonRenderAgent = new HttpAgent({
  url: `${AGENT_URL}/byoc-json-render`,
});

const runtime = new CopilotRuntime({
  // @ts-ignore -- see hashbrown route
  agents: { byoc_json_render: declarativeJsonRenderAgent },
});

export const POST = async (req: NextRequest) => {
  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit-declarative-json-render",
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
