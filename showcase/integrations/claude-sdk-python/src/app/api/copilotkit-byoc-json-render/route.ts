// Dedicated runtime for the BYOC json-render demo.
//
// Isolated from `/api/copilotkit` because the backing agent has a very
// different system prompt (single JSON object, no tools) and bleeding
// that prompt into the shared runtime would break every other demo that
// shares the default Claude backend.
//
// The Python agent server (see src/agent_server.py) exposes a dedicated
// `/byoc-json-render` endpoint that reuses the shared AG-UI streaming
// loop but swaps in the json-render system prompt and disables tools.

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { AbstractAgent, HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

function createAgent() {
  return new HttpAgent({ url: `${AGENT_URL}/byoc-json-render` });
}

// The demo page mounts <CopilotKit agent="byoc_json_render">; resolve
// that to this dedicated agent + expose a `default` alias in case any
// internal `useAgent()` call falls back to the default slug.
const agents: Record<string, AbstractAgent> = {
  byoc_json_render: createAgent(),
  default: createAgent(),
};

export const POST = async (req: NextRequest) => {
  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit-byoc-json-render",
      serviceAdapter: new ExperimentalEmptyAdapter(),
      runtime: new CopilotRuntime({
        // @ts-ignore -- see main route.ts: CopilotRuntime agents type is
        // stricter than a plain Record but fixed in source, pending
        // release.
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
