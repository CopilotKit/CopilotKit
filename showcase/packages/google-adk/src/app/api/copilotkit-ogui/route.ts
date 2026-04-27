// Dedicated runtime for the open-gen-ui and open-gen-ui-advanced demos.
// Both demos share this endpoint but differ on the agent name they pass via
// `<CopilotKit agent="...">`. Mirrors langgraph-python's /api/copilotkit-ogui.

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
  agents: {
    "open-gen-ui": new HttpAgent({ url: `${AGENT_URL}/open_gen_ui` }),
    "open-gen-ui-advanced": new HttpAgent({
      url: `${AGENT_URL}/open_gen_ui_advanced`,
    }),
  },
});

export const POST = async (req: NextRequest) => {
  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit-ogui",
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
