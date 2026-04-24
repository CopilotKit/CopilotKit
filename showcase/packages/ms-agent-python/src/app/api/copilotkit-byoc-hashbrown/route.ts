// Dedicated runtime for the byoc-hashbrown demo.
//
// The demo page (`src/app/demos/byoc-hashbrown/page.tsx`) wraps CopilotChat
// in the HashBrownDashboard provider and overrides the assistant message
// slot with a renderer that consumes hashbrown-shaped structured output via
// `@hashbrownai/react`'s `useUiKit` + `useJsonParser`. The MS Agent behind
// this endpoint (see `src/agents/byoc_hashbrown_agent.py`, mounted at
// `/byoc-hashbrown` in `agent_server.py`) has a system prompt tuned to
// emit that shape.

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

const byocHashbrownAgent = new HttpAgent({
  url: `${AGENT_URL}/byoc-hashbrown`,
});

const runtime = new CopilotRuntime({
  // @ts-ignore -- Published CopilotRuntime agents type wraps Record in
  // MaybePromise<NonEmptyRecord<...>> which rejects plain Records; fixed in
  // source, pending release.
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
    const e = error as { message?: string; stack?: string };
    return NextResponse.json(
      { error: e.message, stack: e.stack },
      { status: 500 },
    );
  }
};
