// Dedicated runtime for the declarative-hashbrown demo. Mirrors
// langgraph-python's /api/copilotkit-declarative-hashbrown route, but uses
// the HttpAgent + AGENT_URL pattern that talks to the Python ADK backend
// process (mounted at /declarative-hashbrown by agent_server.py).

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

const declarativeHashbrownAgent = new HttpAgent({
  url: `${AGENT_URL}/declarative-hashbrown`,
});

const runtime = new CopilotRuntime({
  // @ts-expect-error -- see main route.ts
  agents: { "declarative-hashbrown-demo": declarativeHashbrownAgent },
});

const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
  endpoint: "/api/copilotkit-declarative-hashbrown",
  serviceAdapter: new ExperimentalEmptyAdapter(),
  runtime,
});

export const POST = async (req: NextRequest) => {
  try {
    return await handleRequest(req);
  } catch (error: unknown) {
    const e = error as { message?: string; stack?: string };
    return NextResponse.json(
      { error: e.message, stack: e.stack },
      { status: 500 },
    );
  }
};
