// Dedicated runtime for the declarative-hashbrown demo (LlamaIndex).
//
// The backend agent emits a `<ui>...</ui>` envelope that `@hashbrownai/react`
// parses progressively. The runtime just proxies to the LlamaIndex agent at
// the /byoc-hashbrown subpath. The demo folder + route + agent slug were
// renamed from `byoc-hashbrown` to the canonical `declarative-hashbrown`
// surface; the page mounts <CopilotKit agent="declarative-hashbrown-demo">.

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { AbstractAgent, HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

const declarativeHashbrownAgent = new HttpAgent({
  url: `${AGENT_URL}/byoc-hashbrown/run`,
});

// Register both the named agent and a `default` fallback so the runtime can
// resolve regardless of whether the frontend sends an explicit agentId.
const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
  agents: {
    "declarative-hashbrown-demo": declarativeHashbrownAgent as AbstractAgent,
    default: declarativeHashbrownAgent as AbstractAgent,
  },
});

export const POST = async (req: NextRequest) => {
  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit-declarative-hashbrown",
      serviceAdapter: new ExperimentalEmptyAdapter(),
      runtime,
    });
    return await handleRequest(req);
  } catch (error: unknown) {
    const e = error as { message?: string; stack?: string };
    console.error(
      `[copilotkit-declarative-hashbrown/route] ERROR: ${e.message}`,
      e.stack,
    );
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
};
