// Dedicated runtime for the Multimodal Attachments demo (Wave 2b).
//
// Why its own route? The backing graph (`multimodal`, from
// src/agents/multimodal_agent.py) runs a vision-capable model (gpt-4o). Every
// other cell in the showcase uses a text-only, cheaper model. Registering
// `multimodal` under the shared `/api/copilotkit` runtime would silently upgrade
// *all* cells that share that runtime to a vision model whenever the browser
// routed to this one — wasting tokens and blurring the per-demo cost boundary.
// A dedicated route keeps the vision capability — and its cost — scoped to
// exactly the cell that exercises it, matching the pattern used by
// `/api/copilotkit-beautiful-chat`.
//
// The page at src/app/demos/multimodal/page.tsx points its `runtimeUrl` at
// this endpoint and sets `agent="multimodal-demo"` (the slug registered below).

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { LangGraphAgent } from "@copilotkit/runtime/langgraph";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8123";

const multimodalAgent = new LangGraphAgent({
  deploymentUrl: `${AGENT_URL}/`,
  // graphId references the key in langgraph.json — must match the
  // "multimodal" entry that resolves to src/agents/src/multimodal_agent.py:graph.
  graphId: "multimodal",
});

const agents: Record<string, LangGraphAgent> = {
  // The page's <CopilotKit agent="multimodal-demo"> resolves here.
  "multimodal-demo": multimodalAgent,
  // Alias for any internal component that calls `useAgent()` without args
  // (matches the beautiful-chat route's "default" alias pattern).
  default: multimodalAgent,
};

export const POST = async (req: NextRequest) => {
  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit-multimodal",
      serviceAdapter: new ExperimentalEmptyAdapter(),
      runtime: new CopilotRuntime({
        // @ts-ignore -- see main route.ts; published CopilotRuntime's `agents`
        // type wraps Record in MaybePromise<NonEmptyRecord<...>> which rejects
        // plain Records. Fixed in source, pending release.
        agents,
      }),
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
