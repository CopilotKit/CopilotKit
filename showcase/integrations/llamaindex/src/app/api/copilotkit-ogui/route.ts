// Dedicated runtime for the Open Generative UI demos (minimal + advanced).
//
// Isolated because the `openGenerativeUI` runtime flag sets
// `openGenerativeUIEnabled: true` on the probe response, which would cause
// per-demo `useFrontendTool` / `useComponent` registrations on the default
// runtime to be wiped.

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { AbstractAgent, HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

const openGenUiAgent = new HttpAgent({ url: `${AGENT_URL}/open-gen-ui/run` });
const openGenUiAdvancedAgent = new HttpAgent({
  url: `${AGENT_URL}/open-gen-ui-advanced/run`,
});

const agents = {
  "open-gen-ui": openGenUiAgent as AbstractAgent,
  "open-gen-ui-advanced": openGenUiAdvancedAgent as AbstractAgent,
};

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
    return await handleRequest(req);
  } catch (error: unknown) {
    const e = error as { message?: string; stack?: string };
    return NextResponse.json(
      { error: e.message, stack: e.stack },
      { status: 500 },
    );
  }
};
