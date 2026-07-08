// Dedicated runtime for the declarative-hashbrown demo. Mirrors
// langgraph-python's /api/copilotkit-declarative-hashbrown route, but uses
// the HttpAgent + AGENT_URL pattern that talks to the Python ADK backend
// process (mounted at /declarative-hashbrown by agent_server.py).

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";
// @doc-replace
import { extractForwardedHeaders } from "@/lib/header-forwarding";
// @doc-as
// @doc-end

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

export const POST = async (req: NextRequest) => {
  try {
    // @doc-replace
    const headers = extractForwardedHeaders(req);
    const declarativeHashbrownAgent = new HttpAgent({
      url: `${AGENT_URL}/declarative-hashbrown`,
      headers,
    });
    // @doc-as
    // const declarativeHashbrownAgent = new HttpAgent({
    //   url: `${AGENT_URL}/declarative-hashbrown`,
    // });
    // @doc-end

    const runtime = new CopilotRuntime({
      agents: { "declarative-hashbrown-demo": declarativeHashbrownAgent },
    });

    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit-declarative-hashbrown",
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
