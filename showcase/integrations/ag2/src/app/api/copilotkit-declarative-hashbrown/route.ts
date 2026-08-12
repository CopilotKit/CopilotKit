// Dedicated runtime for the declarative-hashbrown demo (AG2).
//
// The demo page wraps CopilotChat in the HashBrownDashboard provider and
// overrides the assistant message slot with a renderer that consumes
// hashbrown-shaped structured output via `@hashbrownai/react`'s `useUiKit` +
// `useJsonParser`. The agent behind this endpoint (`byoc_hashbrown`) has a
// system prompt tuned to emit that shape — see
// `src/agents/byoc_hashbrown_agent.py`.
//
// The directory name, the `endpoint` below and the agent key are all part of
// the frontend contract: `demos/declarative-hashbrown/page.tsx` (byte-identical
// across integrations, so it cannot be adapted) requests
// `runtimeUrl="/api/copilotkit-declarative-hashbrown"` with
// `agent="declarative-hashbrown-demo"`. They previously read `byoc-*`, which
// 404'd the whole cell. The AG2-side mount path (`/byoc-hashbrown/`) is
// internal and deliberately left alone.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

const byocHashbrownAgent = new HttpAgent({
  url: `${AGENT_URL}/byoc-hashbrown/`,
});

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts; published agents type generic mismatch.
  agents: {
    "declarative-hashbrown-demo": byocHashbrownAgent,
    default: byocHashbrownAgent,
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
    return NextResponse.json(
      { error: e.message, stack: e.stack },
      { status: 500 },
    );
  }
};
