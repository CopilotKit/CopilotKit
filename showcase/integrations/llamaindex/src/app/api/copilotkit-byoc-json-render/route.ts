// Dedicated runtime for the BYOC json-render demo.
//
// The backend agent emits a `{ root, elements }` JSON spec that
// `@json-render/react` on the frontend parses progressively. The runtime
// just proxies to the LlamaIndex agent at the /byoc-json-render subpath.

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { AbstractAgent, HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

const byocJsonRenderAgent = new HttpAgent({
  url: `${AGENT_URL}/byoc-json-render/run`,
});

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
  agents: { byoc_json_render: byocJsonRenderAgent as AbstractAgent },
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
