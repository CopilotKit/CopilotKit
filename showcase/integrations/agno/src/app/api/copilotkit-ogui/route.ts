// Dedicated runtime for the Open Generative UI demos (Agno).
//
// Isolated here because the `openGenerativeUI` runtime flag sets
// `openGenerativeUIEnabled: true` globally on the probe response, which
// causes the CopilotKit provider's setTools effect to wipe per-demo
// `useFrontendTool`/`useComponent` registrations in the default runtime.
//
// The Agno backend exposes a no-tools agent at `/open-gen-ui/agui` (see
// `agent_server.py`); the runtime middleware turns each
// `generateSandboxedUi` tool call the agent emits into an
// `open-generative-ui` activity event the built-in renderer mounts inside a
// sandboxed iframe.

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

const openGenUiAgent = new HttpAgent({ url: `${AGENT_URL}/open-gen-ui/agui` });
const openGenUiAdvancedAgent = new HttpAgent({
  url: `${AGENT_URL}/open-gen-ui/agui`,
});

const agents = {
  "open-gen-ui": openGenUiAgent,
  "open-gen-ui-advanced": openGenUiAdvancedAgent,
} as const;

export const POST = async (req: NextRequest) => {
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
      // Open Generative UI for the listed agent(s).
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
    return await handleRequest(req);
  } catch (error: unknown) {
    const e = error as { message?: string; stack?: string };
    return NextResponse.json(
      { error: e.message, stack: e.stack },
      { status: 500 },
    );
  }
};
