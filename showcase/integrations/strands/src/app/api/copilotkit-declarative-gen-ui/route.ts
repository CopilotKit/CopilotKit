// Dedicated runtime for the Declarative Generative UI (A2UI dynamic) demo.
// Scoped so a2ui options for this cell stay isolated from the shared route.
//
// Backend: AGENT_URL/declarative-gen-ui/ (already mounted in agent_server.py).
// The a2ui_dynamic agent wires NO generate_a2ui tool — the Strands adapter
// auto-injects it when the runtime forwards injectA2UITool: true (see
// src/agents/a2ui_dynamic.py).

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

// Set SHOWCASE_ROUTE_DEBUG=1 to re-enable verbose per-request tracing locally.
const ROUTE_DEBUG =
  process.env.SHOWCASE_ROUTE_DEBUG === "1" ||
  process.env.SHOWCASE_ROUTE_DEBUG === "true";

function createAgent() {
  // Dedicated backend agent mounted at /declarative-gen-ui. Trailing slash so
  // the sub-application's root route resolves.
  return new HttpAgent({ url: `${AGENT_URL}/declarative-gen-ui/` });
}

const a2uiAgent = createAgent();
const agents = {
  "declarative-gen-ui": a2uiAgent,
  default: a2uiAgent,
};

const runtime = new CopilotRuntime({
  // @ts-ignore -- Published CopilotRuntime agents type wraps Record in MaybePromise<NonEmptyRecord<...>> which rejects plain Records; fixed in source, pending release
  agents,
  a2ui: {
    // a2ui_dynamic agent is tool-free; Strands adapter auto-injects
    // generate_a2ui when this flag is true (see src/agents/a2ui_dynamic.py).
    injectA2UITool: true,
    // Models omit catalogId; pin the catalog the page registers.
    defaultCatalogId: "declarative-gen-ui-catalog",
  },
});

export const POST = async (req: NextRequest) => {
  if (ROUTE_DEBUG) {
    console.log(`[copilotkit-declarative-gen-ui/route] POST ${req.url}`);
  }

  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit-declarative-gen-ui",
      serviceAdapter: new ExperimentalEmptyAdapter(),
      runtime,
    });
    const response = await handleRequest(req);
    if (!response.ok) {
      console.log(
        `[copilotkit-declarative-gen-ui/route] Response status: ${response.status}`,
      );
    } else if (ROUTE_DEBUG) {
      console.log(
        `[copilotkit-declarative-gen-ui/route] Response status: ${response.status}`,
      );
    }
    return response;
  } catch (error: unknown) {
    const e = error as { message?: string; stack?: string };
    return NextResponse.json(
      { error: e.message, stack: e.stack },
      { status: 500 },
    );
  }
};
