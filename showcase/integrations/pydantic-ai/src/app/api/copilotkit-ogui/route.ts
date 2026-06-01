import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { AbstractAgent, HttpAgent } from "@ag-ui/client";

// Dedicated runtime for the Open Generative UI demos.
// Isolated here because the `openGenerativeUI` runtime flag sets
// `openGenerativeUIEnabled: true` globally on the probe response, which
// causes the CopilotKit provider's setTools effect to wipe per-demo
// `useFrontendTool`/`useComponent` registrations in the default runtime.
//
// Mirrors showcase/integrations/langgraph-python/src/app/api/copilotkit-ogui/route.ts
// but proxies to dedicated PydanticAI mounts (see src/agent_server.py).

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

const agents: Record<string, AbstractAgent> = {
  "open-gen-ui": new HttpAgent({ url: `${AGENT_URL}/open_gen_ui/` }),
  "open-gen-ui-advanced": new HttpAgent({
    url: `${AGENT_URL}/open_gen_ui_advanced/`,
  }),
};

// @region[minimal-runtime-flag]
// @region[advanced-runtime-config]
// Server-side config is identical for the minimal and advanced cells —
// the advanced behaviour (sandbox -> host function calls) is wired
// entirely on the frontend via `openGenerativeUI.sandboxFunctions` on
// the provider. The single `openGenerativeUI` flag below turns on
// Open Generative UI for the listed agent(s); the runtime middleware
// converts each agent's streamed `generateSandboxedUi` tool call into
// `open-generative-ui` activity events.
const runtime = new CopilotRuntime({
  // @ts-ignore -- Published CopilotRuntime agents type wraps Record in MaybePromise<NonEmptyRecord<...>> which rejects plain Records; fixed in source, pending release
  agents,
  openGenerativeUI: {
    agents: ["open-gen-ui", "open-gen-ui-advanced"],
  },
});
// @endregion[advanced-runtime-config]
// @endregion[minimal-runtime-flag]

export const POST = async (req: NextRequest) => {
  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit-ogui",
      serviceAdapter: new ExperimentalEmptyAdapter(),
      runtime,
    });
    return await handleRequest(req);
  } catch (error: unknown) {
    const err = error as Error;
    return NextResponse.json(
      { error: err.message, stack: err.stack },
      { status: 500 },
    );
  }
};
