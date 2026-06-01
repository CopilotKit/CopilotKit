// Dedicated runtime for the byoc-hashbrown demo (Agno).

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { AbstractAgent, HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

console.log(`[copilotkit-byoc-hashbrown/route] AGENT_URL: ${AGENT_URL}`);

function createByocHashbrownAgent() {
  return new HttpAgent({
    url: `${AGENT_URL}/byoc-hashbrown/agui`,
  });
}

// Register both the named agent and a default fallback so the runtime
// can always resolve regardless of which agent name the frontend sends.
const agents: Record<string, AbstractAgent> = {
  "byoc-hashbrown-demo": createByocHashbrownAgent(),
  default: createByocHashbrownAgent(),
};

export const POST = async (req: NextRequest) => {
  const url = req.url;
  console.log(`[copilotkit-byoc-hashbrown/route] POST ${url}`);

  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit-byoc-hashbrown",
      serviceAdapter: new ExperimentalEmptyAdapter(),
      runtime: new CopilotRuntime({
        // @ts-ignore -- see main route.ts
        agents,
      }),
    });
    const response = await handleRequest(req);
    console.log(
      `[copilotkit-byoc-hashbrown/route] Response status: ${response.status}`,
    );
    return response;
  } catch (error: unknown) {
    const e = error as { message?: string; stack?: string };
    console.error(`[copilotkit-byoc-hashbrown/route] ERROR: ${e.message}`);
    console.error(`[copilotkit-byoc-hashbrown/route] Stack: ${e.stack}`);
    return NextResponse.json(
      { error: e.message, stack: e.stack },
      { status: 500 },
    );
  }
};
