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
      runtime: new CopilotRuntime({
        // @ts-ignore -- see main route.ts
        agents,
        openGenerativeUI: {
          agents: ["open-gen-ui", "open-gen-ui-advanced"],
        },
      }),
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
