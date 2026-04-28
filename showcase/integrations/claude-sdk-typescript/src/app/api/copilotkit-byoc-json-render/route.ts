/**
 * Dedicated runtime for the BYOC json-render demo.
 *
 * Proxies to the Claude agent_server's `/byoc-json-render` endpoint, which
 * swaps in a system prompt instructing Claude to emit a `@json-render/react`
 * flat-spec JSON object. Isolated from the shared `/api/copilotkit` runtime
 * so the BYOC system prompt cannot leak into other demos.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { AbstractAgent, HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

const agents: Record<string, AbstractAgent> = {
  byoc_json_render: new HttpAgent({
    url: `${AGENT_URL}/byoc-json-render`,
  }),
};

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
  agents,
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
