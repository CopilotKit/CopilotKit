// Dedicated runtime for the byoc-hashbrown demo (Langroid).
//
// The demo page wraps CopilotChat in HashBrownDashboard and overrides the
// assistant message slot with a renderer that consumes hashbrown-shaped
// structured output via `@hashbrownai/react`'s `useUiKit` + `useJsonParser`.
// The agent behind this endpoint is the FastAPI handler at
// `${AGENT_URL}/byoc-hashbrown` whose system prompt is tuned to emit the
// hashbrown JSON envelope (see `src/agents/byoc_hashbrown_agent.py`).

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

const byocHashbrownAgent = new HttpAgent({
  url: `${AGENT_URL}/byoc-hashbrown`,
});

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
  agents: {
    "byoc-hashbrown-demo": byocHashbrownAgent,
    default: byocHashbrownAgent,
  },
});

export const POST = async (req: NextRequest) => {
  try {
    const copilotHandler = createCopilotRuntimeHandler({
      runtime,
      basePath: "/api/copilotkit-byoc-hashbrown",
      mode: "single-route",
    });
    return await copilotHandler(req);
  } catch (error: unknown) {
    const e = error as { message?: string; stack?: string };
    return NextResponse.json(
      { error: e.message, stack: e.stack },
      { status: 500 },
    );
  }
};
