// Dedicated runtime for the byoc-hashbrown demo. Mirrors langgraph-python's
// /api/copilotkit-byoc-hashbrown route.

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

const byocHashbrownAgent = new HttpAgent({
  url: `${AGENT_URL}/byoc_hashbrown`,
});

const runtime = new CopilotRuntime({
  // @ts-expect-error -- see main route.ts
  agents: { "byoc-hashbrown-demo": byocHashbrownAgent },
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
    console.error("[copilotkit-byoc-hashbrown]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
};
