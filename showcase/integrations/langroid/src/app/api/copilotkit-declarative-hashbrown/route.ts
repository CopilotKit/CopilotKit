// Dedicated runtime for the declarative-hashbrown demo (Langroid).
//
// The demo page wraps CopilotChat in HashBrownDashboard and overrides the
// assistant message slot with a renderer that consumes hashbrown-shaped
// structured output via `@hashbrownai/react`'s `useUiKit` + `useJsonParser`.
// The agent behind this endpoint is the FastAPI handler at
// `${AGENT_URL}/byoc-hashbrown` whose system prompt is tuned to emit the
// hashbrown JSON envelope (see `src/agents/byoc_hashbrown_agent.py`). The
// demo folder + route + agent slug were renamed from `byoc-hashbrown` to the
// canonical `declarative-hashbrown` surface; the page mounts
// <CopilotKit agent="declarative-hashbrown-demo">.

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

const declarativeHashbrownAgent = new HttpAgent({
  url: `${AGENT_URL}/byoc-hashbrown`,
});

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
  agents: {
    "declarative-hashbrown-demo": declarativeHashbrownAgent,
    default: declarativeHashbrownAgent,
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
