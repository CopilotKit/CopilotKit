// CopilotKit runtime for the Agentic Chat cell (AG2).
// Self-contained — proxies to a single AG2 AG-UI backend.

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

const runtime = new CopilotRuntime({
  // @ts-ignore — CopilotRuntime agents type wraps Record in MaybePromise<NonEmptyRecord<...>>
  agents: { agentic_chat: new HttpAgent({ url: `${AGENT_URL}/` }) },
});

export const POST = async (req: NextRequest) => {
  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit",
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
