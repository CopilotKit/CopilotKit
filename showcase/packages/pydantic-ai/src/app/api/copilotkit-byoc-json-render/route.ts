// Dedicated runtime for the BYOC json-render demo.
//
// Mirrors showcase/packages/langgraph-python/src/app/api/copilotkit-byoc-json-render/route.ts
// but proxies to the PydanticAI backend's `/byoc_json_render/` mount
// (see src/agent_server.py).

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

const byocJsonRenderAgent = new HttpAgent({
  url: `${AGENT_URL}/byoc_json_render/`,
});

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts: published CopilotRuntime agents type
  // wraps Record in MaybePromise<NonEmptyRecord<...>> which rejects plain
  // Records; fixed in source, pending release.
  agents: { byoc_json_render: byocJsonRenderAgent },
});

export const POST = async (req: NextRequest) => {
  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit-byoc-json-render",
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
