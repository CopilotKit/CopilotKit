// Dedicated runtime for the BYOC hashbrown demo.
//
// Mirrors showcase/packages/langgraph-python/src/app/api/copilotkit-byoc-hashbrown/route.ts
// but proxies to the PydanticAI backend's `/byoc_hashbrown/` mount
// (see src/agent_server.py).

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { AbstractAgent, HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

// The page mounts <CopilotKit agent="byoc-hashbrown-demo">; register
// that name + a `default` alias (for any internal useAgent() lookups).
const agents: Record<string, AbstractAgent> = {
  "byoc-hashbrown-demo": new HttpAgent({ url: `${AGENT_URL}/byoc_hashbrown/` }),
  default: new HttpAgent({ url: `${AGENT_URL}/byoc_hashbrown/` }),
};

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
  agents,
});

export const POST = async (req: NextRequest) => {
  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit-byoc-hashbrown",
      serviceAdapter: new ExperimentalEmptyAdapter(),
      runtime,
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
