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
  // src/agent_server.py). It wires NO generate_a2ui tool — the runtime's
  // `injectA2UITool: true` below makes the Strands adapter auto-inject it and
  // GENERATE the surface layout. Trailing slash so the sub-application's root
  // route resolves.
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
        // Enable A2UI tool injection: the runtime injects a `generate_a2ui`
        // tool and drives a secondary render planner to emit the surface ops,
        // then the A2UIMiddleware paints them. The Strands adapter auto-injects
        // the tool when it sees this forwarded flag. Pin the catalog the page
        // registers so the planner doesn't fall back to the unregistered spec
        // basic catalog ("Catalog not found"). Mirrors the langgraph-python
        // declarative-gen-ui route.
        a2ui: {
          injectA2UITool: true,
          defaultCatalogId: "declarative-gen-ui-catalog",
        },
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
