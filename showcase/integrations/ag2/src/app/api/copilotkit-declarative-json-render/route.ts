// Dedicated runtime for the declarative-json-render demo (AG2).
//
// The directory name and the `endpoint` below are part of the frontend
// contract: `demos/declarative-json-render/page.tsx` (byte-identical across
// integrations) requests `runtimeUrl="/api/copilotkit-declarative-json-render"`.
// Both previously read `byoc-*`, which 404'd the whole cell. The agent key
// `byoc_json_render` is NOT a typo — it is what `chat.tsx` exports as
// `AGENT_ID` and passes as `agent={AGENT_ID}`. The AG2-side mount path
// (`/byoc-json-render/`) is internal and deliberately left alone.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

const byocJsonRenderAgent = new HttpAgent({
  url: `${AGENT_URL}/byoc-json-render/`,
});

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts; published agents type generic mismatch.
  agents: {
    byoc_json_render: byocJsonRenderAgent,
    default: byocJsonRenderAgent,
  },
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
