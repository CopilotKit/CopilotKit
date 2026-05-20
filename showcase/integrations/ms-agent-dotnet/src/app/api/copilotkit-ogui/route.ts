import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { AbstractAgent, HttpAgent } from "@ag-ui/client";

// Dedicated runtime for the Open Generative UI demos, mirroring the
// LangGraph-Python `copilotkit-ogui` route.
//
// Isolated here because the `openGenerativeUI` runtime flag sets
// `openGenerativeUIEnabled: true` globally on the probe response, which
// causes the CopilotKit provider's setTools effect to wipe per-demo
// `useFrontendTool`/`useComponent` registrations in the default runtime.
//
// Each agent name proxies to a separate `MapAGUI` endpoint on the .NET
// backend (see `agent/Program.cs`).

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

console.log("[copilotkit-ogui/route] Initializing OGUI CopilotKit runtime");
console.log(`[copilotkit-ogui/route] AGENT_URL: ${AGENT_URL}`);

const openGenUiAgent = new HttpAgent({ url: `${AGENT_URL}/open-gen-ui` });
const openGenUiAdvancedAgent = new HttpAgent({
  url: `${AGENT_URL}/open-gen-ui-advanced`,
});

const agents: Record<string, AbstractAgent> = {
  "open-gen-ui": openGenUiAgent,
  "open-gen-ui-advanced": openGenUiAdvancedAgent,
};

export const POST = async (req: NextRequest) => {
  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit-ogui",
      serviceAdapter: new ExperimentalEmptyAdapter(),
      // Server-side config is identical for the minimal and advanced cells —
      // the advanced behaviour (sandbox -> host function calls) is wired
      // entirely on the frontend via `openGenerativeUI.sandboxFunctions` on
      // the provider. The single `openGenerativeUI` flag below turns on
      // Open Generative UI for the listed agent(s); the runtime middleware
      // converts each agent's streamed `generateSandboxedUi` tool call into
      // `open-generative-ui` activity events.
      // @region[minimal-runtime-flag]
      // @region[advanced-runtime-config]
      runtime: new CopilotRuntime({
        // @ts-ignore -- Published CopilotRuntime agents type wraps Record in MaybePromise<NonEmptyRecord<...>> which rejects plain Records; fixed in source, pending release
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
    const err = error as Error;
    console.error(`[copilotkit-ogui/route] ERROR: ${err.message}`);
    return NextResponse.json(
      { error: err.message, stack: err.stack },
      { status: 500 },
    );
  }
};
