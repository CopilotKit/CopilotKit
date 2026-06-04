// Dedicated runtime for the declarative-json-render demo.
//
// The frontend demo (`src/app/demos/declarative-json-render/page.tsx`)
// keeps the canonical `byoc_json_render` agent slug (a deliberate
// LGP-canonical choice — the demo folder + route were renamed but the
// agent ID retains its legacy name). PydanticAI backend mounts the
// underlying agent at `/byoc_json_render/` (see `src/agent_server.py`).

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
      endpoint: "/api/copilotkit-declarative-json-render",
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
