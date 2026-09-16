// Dedicated runtime for the BYOC json-render demo.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

function createAgent() {
  return new HttpAgent({ url: `${AGENT_URL}/` });
}

const byocJsonRenderAgent = createAgent();
const agents = {
  byoc_json_render: byocJsonRenderAgent,
  default: byocJsonRenderAgent,
};

export const POST = async (req: NextRequest) => {
  try {
    const copilotHandler = createCopilotRuntimeHandler({
      runtime: new CopilotRuntime({
        // @ts-ignore -- Published CopilotRuntime agents type wraps Record in MaybePromise<NonEmptyRecord<...>> which rejects plain Records; fixed in source, pending release
        agents,
      }),
      basePath: "/api/copilotkit-byoc-json-render",
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
