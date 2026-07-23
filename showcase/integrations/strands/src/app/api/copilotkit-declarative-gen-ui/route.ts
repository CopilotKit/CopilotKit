// Dedicated runtime for the Declarative Generative UI (A2UI dynamic) demo.
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
  // Dedicated backend agent mounted at /declarative-gen-ui (see
  // src/agent_server.py). It wires NO generate_a2ui tool — the catalog the page
  // passes to the provider auto-enables A2UI tool injection, so the Strands
  // adapter auto-injects it and GENERATEs the surface layout. Trailing slash so
  // the sub-application's root route resolves.
  return new HttpAgent({ url: `${AGENT_URL}/declarative-gen-ui/` });
}

const a2uiAgent = createAgent();
const agents = {
  "declarative-gen-ui": a2uiAgent,
  default: a2uiAgent,
};

export const POST = async (req: NextRequest) => {
  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit-declarative-gen-ui",
      serviceAdapter: new ExperimentalEmptyAdapter(),
      runtime: new CopilotRuntime({
        // @ts-ignore -- Published CopilotRuntime agents type wraps Record in MaybePromise<NonEmptyRecord<...>> which rejects plain Records; fixed in source, pending release
        agents,
        // No runtime `a2ui` config: the page passes a catalog to the provider
        // (`<CopilotKit a2ui={{ catalog }}>`), which auto-enables A2UI and
        // defaults tool injection on (CopilotKit >= 1.61.2, PR #5611). The
        // Strands adapter then auto-injects `generate_a2ui` from the forwarded
        // flag and drives the render planner the A2UIMiddleware paints.
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
