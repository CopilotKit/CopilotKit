// Dedicated runtime for the A2UI Error Recovery demo.
// Scoped so a2ui options for this cell stay isolated from the shared route.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

function createAgent() {
  // Dedicated backend agent mounted at /a2ui-recovery (see src/agent_server.py).
  // It wires NO generate_a2ui tool — the catalog the page passes to the provider
  // auto-enables A2UI tool injection, so the Strands adapter auto-injects it,
  // drives the render_a2ui planner, and runs the toolkit validate->retry
  // recovery loop on that auto-inject path. Trailing slash so the
  // sub-application's root route resolves.
  return new HttpAgent({ url: `${AGENT_URL}/a2ui-recovery/` });
}

const a2uiAgent = createAgent();
const agents = {
  "a2ui-recovery": a2uiAgent,
  default: a2uiAgent,
};

export const POST = async (req: NextRequest) => {
  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit-a2ui-recovery",
      serviceAdapter: new ExperimentalEmptyAdapter(),
      runtime: new CopilotRuntime({
        // @ts-ignore -- Published CopilotRuntime agents type wraps Record in MaybePromise<NonEmptyRecord<...>> which rejects plain Records; fixed in source, pending release
        agents,
        // No runtime `a2ui` config: the page passes a catalog to the provider
        // (`<CopilotKit a2ui={{ catalog }}>`), which auto-enables A2UI and
        // defaults tool injection on (CopilotKit >= 1.61.2, PR #5611). The
        // Strands adapter then auto-injects `generate_a2ui` and runs the
        // recovery loop the A2UIMiddleware renders.
      }),
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
