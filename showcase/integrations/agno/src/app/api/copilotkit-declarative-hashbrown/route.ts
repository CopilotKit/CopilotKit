// Dedicated runtime for the declarative-hashbrown demo (Agno).
//
// The demo folder + route + agent slug were renamed from `byoc-hashbrown`
// to the canonical `declarative-hashbrown` surface; the underlying Agno
// agent still mounts at `/byoc-hashbrown/agui` (see src/agent_server.py).
// The demo page mounts <CopilotKit agent="declarative-hashbrown-demo">.

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { AbstractAgent, HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

console.log(`[copilotkit-declarative-hashbrown/route] AGENT_URL: ${AGENT_URL}`);

// Per-request request/response logging is gated behind this flag (default off).
// Under d6 probe fan-out, unconditional per-request logs flooded Railway's
// 500-logs/sec cap and killed the replica ("Messages dropped" → container stop).
// Set SHOWCASE_ROUTE_DEBUG=1 to re-enable verbose per-request tracing locally.
const ROUTE_DEBUG =
  process.env.SHOWCASE_ROUTE_DEBUG === "1" ||
  process.env.SHOWCASE_ROUTE_DEBUG === "true";

function createDeclarativeHashbrownAgent() {
  return new HttpAgent({
    url: `${AGENT_URL}/byoc-hashbrown/agui`,
  });
}

// Register both the named agent and a default fallback so the runtime
// can always resolve regardless of which agent name the frontend sends.
const agents: Record<string, AbstractAgent> = {
  "declarative-hashbrown-demo": createDeclarativeHashbrownAgent(),
  default: createDeclarativeHashbrownAgent(),
};

export const POST = async (req: NextRequest) => {
  const url = req.url;
  if (ROUTE_DEBUG) {
    console.log(`[copilotkit-declarative-hashbrown/route] POST ${url}`);
  }

  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit-declarative-hashbrown",
      serviceAdapter: new ExperimentalEmptyAdapter(),
      runtime: new CopilotRuntime({
        // @ts-expect-error -- see main route.ts
        agents,
      }),
    });
    const response = await handleRequest(req);
    if (!response.ok) {
      console.log(
        `[copilotkit-declarative-hashbrown/route] Response status: ${response.status}`,
      );
    } else if (ROUTE_DEBUG) {
      console.log(
        `[copilotkit-declarative-hashbrown/route] Response status: ${response.status}`,
      );
    }
    return response;
  } catch (error: unknown) {
    const e = error as { message?: string; stack?: string };
    console.error(
      `[copilotkit-declarative-hashbrown/route] ERROR: ${e.message}`,
    );
    console.error(`[copilotkit-declarative-hashbrown/route] Stack: ${e.stack}`);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
};
