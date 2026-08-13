// Dedicated runtime for the A2UI Error Recovery demo (Strands).
//
// Unlike LGP (injectA2UITool: false — backend owns generate_a2ui via
// get_a2ui_tools), the Strands recovery_agent is tool-free: the adapter
// auto-injects generate_a2ui and runs the toolkit validate→retry recovery
// loop when the runtime forwards injectA2UITool: true. Keep injectA2UITool
// true (and pin the catalog the page registers).
//
// Backend already mounted at AGENT_URL/a2ui-recovery/ (agent_server.py).

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
  // Dedicated backend agent mounted at /a2ui-recovery (see src/agent_server.py).
  // It wires NO generate_a2ui tool — the runtime injects it so the Strands
  // adapter drives the render_a2ui planner + recovery loop. Trailing slash so
  // the sub-application's root route resolves.
  return new HttpAgent({ url: `${AGENT_URL}/a2ui-recovery/` });
}

const a2uiAgent = createAgent();
const agents = {
  "a2ui-recovery": a2uiAgent,
  default: a2uiAgent,
};

const runtime = new CopilotRuntime({
  // @ts-ignore -- Published CopilotRuntime agents type wraps Record in MaybePromise<NonEmptyRecord<...>> which rejects plain Records; fixed in source, pending release
  agents,
  a2ui: {
    // recovery_agent is tool-free; Strands adapter recovery path requires
    // auto-injection (see src/agents/recovery_agent.py). LGP uses false
    // because its graph owns generate_a2ui explicitly.
    injectA2UITool: true,
    // Reuse the catalog the page registers (shared with declarative-gen-ui).
    defaultCatalogId: "declarative-gen-ui-catalog",
  },
});

export const POST = async (req: NextRequest) => {
  if (ROUTE_DEBUG) {
    console.log(`[copilotkit-a2ui-recovery/route] POST ${req.url}`);
  }

  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit-a2ui-recovery",
      serviceAdapter: new ExperimentalEmptyAdapter(),
      runtime,
    });
    const response = await handleRequest(req);
    if (!response.ok) {
      console.log(
        `[copilotkit-a2ui-recovery/route] Response status: ${response.status}`,
      );
    } else if (ROUTE_DEBUG) {
      console.log(
        `[copilotkit-a2ui-recovery/route] Response status: ${response.status}`,
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
