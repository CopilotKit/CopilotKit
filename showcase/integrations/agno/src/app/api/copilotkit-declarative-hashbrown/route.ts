// Dedicated runtime for the declarative-hashbrown demo (Agno).
//
// The demo folder + route + agent slug were renamed from `byoc-hashbrown`
// to the canonical `declarative-hashbrown` surface; the underlying Agno
// agent still mounts at `/byoc-hashbrown/agui` (see src/agent_server.py).
// The demo page mounts <CopilotKit agent="declarative-hashbrown-demo">.

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { AbstractAgent, HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

console.log(`[copilotkit-declarative-hashbrown/route] AGENT_URL: ${AGENT_URL}`);

function createDeclarativeHashbrownAgent() {
  return new HttpAgent({
    url: `${AGENT_URL}/byoc-hashbrown/agui`,
  });
}

// Register both the named agent and a default fallback so the runtime
// can always resolve regardless of which agent name the frontend sends.
const agents: Record<string, AbstractAgent> = {
  "declarative-hashbrown-demo": createDeclarativeHashbrownAgent(),
  default: createDeclarativeHashbrownAgent(),
};

export const POST = async (req: NextRequest) => {
  const url = req.url;
  console.log(`[copilotkit-declarative-hashbrown/route] POST ${url}`);

  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit-declarative-hashbrown",
      serviceAdapter: new ExperimentalEmptyAdapter(),
      runtime: new CopilotRuntime({
        // @ts-ignore -- see main route.ts
        agents,
      }),
    });
    const response = await handleRequest(req);
    console.log(
      `[copilotkit-declarative-hashbrown/route] Response status: ${response.status}`,
    );
    return response;
  } catch (error: unknown) {
    const e = error as { message?: string; stack?: string };
    console.error(`[copilotkit-declarative-hashbrown/route] ERROR: ${e.message}`);
    console.error(`[copilotkit-declarative-hashbrown/route] Stack: ${e.stack}`);
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
};
