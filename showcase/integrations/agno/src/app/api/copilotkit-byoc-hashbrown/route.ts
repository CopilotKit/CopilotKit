// Dedicated runtime for the byoc-hashbrown demo (Agno).

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { AbstractAgent, HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

console.log(`[copilotkit-byoc-hashbrown/route] AGENT_URL: ${AGENT_URL}`);

// Per-request request/response logging is gated behind this flag (default off).
// Under d6 probe fan-out, unconditional per-request logs flooded Railway's
// 500-logs/sec cap and killed the replica ("Messages dropped" → container stop).
// Set SHOWCASE_ROUTE_DEBUG=1 to re-enable verbose per-request tracing locally.
const ROUTE_DEBUG =
  process.env.SHOWCASE_ROUTE_DEBUG === "1" ||
  process.env.SHOWCASE_ROUTE_DEBUG === "true";

function createByocHashbrownAgent() {
  return new HttpAgent({
    url: `${AGENT_URL}/byoc-hashbrown/agui`,
  });
}

// Register both the named agent and a default fallback so the runtime
// can always resolve regardless of which agent name the frontend sends.
const agents: Record<string, AbstractAgent> = {
  "byoc-hashbrown-demo": createByocHashbrownAgent(),
  default: createByocHashbrownAgent(),
};

export const POST = async (req: NextRequest) => {
  const url = req.url;
  if (ROUTE_DEBUG) {
    console.log(`[copilotkit-byoc-hashbrown/route] POST ${url}`);
  }

  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit-byoc-hashbrown",
      serviceAdapter: new ExperimentalEmptyAdapter(),
      runtime: new CopilotRuntime({
        // @ts-expect-error -- see main route.ts
        agents,
      }),
    });
    const response = await handleRequest(req);
    if (!response.ok) {
      console.log(
        `[copilotkit-byoc-hashbrown/route] Response status: ${response.status}`,
      );
    } else if (ROUTE_DEBUG) {
      console.log(
        `[copilotkit-byoc-hashbrown/route] Response status: ${response.status}`,
      );
    }
    return response;
  } catch (error: unknown) {
    const e = error as { message?: string; stack?: string };
    console.error(`[copilotkit-byoc-hashbrown/route] ERROR: ${e.message}`);
    console.error(`[copilotkit-byoc-hashbrown/route] Stack: ${e.stack}`);
    return NextResponse.json(
      { error: e.message, stack: e.stack },
      { status: 500 },
    );
  }
};
