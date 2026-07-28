// Dedicated runtime for the Open Generative UI demos (Strands).
//
// Isolated here because the `openGenerativeUI` runtime flag sets
// `openGenerativeUIEnabled: true` globally on the probe response, which
// causes the CopilotKit provider's setTools effect to wipe per-demo
// `useFrontendTool`/`useComponent` registrations in the default runtime.
//
// Each OGUI agent points at a dedicated sub-path on the Strands agent_server
// (B4/B6 mount these names so wire-server matches):
//   - open-gen-ui          → AGENT_URL/open-gen-ui/
//   - open-gen-ui-advanced → AGENT_URL/open-gen-ui-advanced/

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { AbstractAgent, HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

// Set SHOWCASE_ROUTE_DEBUG=1 to re-enable verbose per-request tracing locally.
const ROUTE_DEBUG =
  process.env.SHOWCASE_ROUTE_DEBUG === "1" ||
  process.env.SHOWCASE_ROUTE_DEBUG === "true";

const agents: Record<string, AbstractAgent> = {
  "open-gen-ui": new HttpAgent({ url: `${AGENT_URL}/open-gen-ui/` }),
  "open-gen-ui-advanced": new HttpAgent({
    url: `${AGENT_URL}/open-gen-ui-advanced/`,
  }),
  // Fallback for internal useAgent() calls with no agentId.
  default: new HttpAgent({ url: `${AGENT_URL}/open-gen-ui/` }),
};

export const POST = async (req: NextRequest) => {
  if (ROUTE_DEBUG) {
    console.log(`[copilotkit-ogui/route] POST ${req.url}`);
  }

  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit-ogui",
      serviceAdapter: new ExperimentalEmptyAdapter(),
      // @region[minimal-runtime-flag]
      // @region[advanced-runtime-config]
      // Server-side config is identical for the minimal and advanced cells —
      // the advanced behaviour (sandbox -> host function calls) is wired
      // entirely on the frontend via `openGenerativeUI.sandboxFunctions` on
      // the provider. The single `openGenerativeUI` flag below turns on
      // Open Generative UI for the listed agent(s); the runtime middleware
      // converts each agent's streamed `generateSandboxedUi` tool call into
      // `open-generative-ui` activity events.
      runtime: new CopilotRuntime({
        // @ts-ignore -- see main route.ts
        agents,
        openGenerativeUI: {
          agents: ["open-gen-ui", "open-gen-ui-advanced"],
        },
      }),
      // @endregion[advanced-runtime-config]
      // @endregion[minimal-runtime-flag]
    });
    const response = await handleRequest(req);
    if (!response.ok) {
      console.log(`[copilotkit-ogui/route] Response status: ${response.status}`);
    } else if (ROUTE_DEBUG) {
      console.log(`[copilotkit-ogui/route] Response status: ${response.status}`);
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
