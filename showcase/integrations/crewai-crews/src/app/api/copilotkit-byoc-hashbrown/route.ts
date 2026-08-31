// Dedicated runtime for the byoc-hashbrown demo.
//
// The page wraps CopilotChat in the HashBrownDashboard provider and
// overrides the assistant message slot with a renderer that consumes
// hashbrown-shaped structured output via `@hashbrownai/react`'s
// `useUiKit` + `useJsonParser`. The agent behind this endpoint
// (`byoc_hashbrown_agent` crew) has a system prompt tuned to emit that
// shape as JSON (see src/agents/byoc_hashbrown_agent.py).
//
// Agent URL points at the dedicated `/byoc-hashbrown` FastAPI endpoint
// mounted by `agent_server.py`.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import type { AbstractAgent } from "@ag-ui/client";
import { HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

function createAgent() {
  return new HttpAgent({ url: `${AGENT_URL}/byoc-hashbrown` });
}

const agents: Record<string, AbstractAgent> = {
  "byoc-hashbrown-demo": createAgent(),
  default: createAgent(),
};

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
  agents,
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
