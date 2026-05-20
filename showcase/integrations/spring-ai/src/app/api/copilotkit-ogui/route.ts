import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { AbstractAgent, HttpAgent } from "@ag-ui/client";

// Dedicated runtime for Open Generative UI demos.
//
// Isolated from the shared `/api/copilotkit` route because the
// `openGenerativeUI` flag on the runtime sets `openGenerativeUIEnabled: true`
// on the probe response. Setting it globally would cause every cell's
// provider to re-mount tools with the OGUI middleware active. Scoping to
// per-demo keeps the OGUI behavior exactly where expected.
//
// The underlying agent is the SAME Spring-AI ChatClient the main runtime
// routes to — the OGUI behavior is driven entirely by the runtime flag
// + provider-side `designSkill` / `sandboxFunctions` props, which get
// injected as agent context on the LLM turn. No new Java endpoint needed;
// we just point multiple named agents at the same Spring controller URL.

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

function createAgent() {
  return new HttpAgent({ url: `${AGENT_URL}/` });
}

const agents: Record<string, AbstractAgent> = {
  "open-gen-ui": createAgent(),
  "open-gen-ui-advanced": createAgent(),
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
    const err = error as Error;
    console.error(`[copilotkit-ogui/route] ERROR: ${err.message}`);
    return NextResponse.json(
      { error: err.message, stack: err.stack },
      { status: 500 },
    );
  }
};
