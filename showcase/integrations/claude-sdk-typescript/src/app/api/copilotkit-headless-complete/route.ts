// Dedicated runtime for the Headless Chat (Complete) cell. The Claude
// SDK backend exposes its own `get_weather` and `get_stock_price` tools
// at the `/headless-complete` endpoint (see
// `src/agent/headless-complete-prompt.ts`). The frontend additionally
// registers a `highlight_note` tool via `useComponent` — that one is
// forwarded to Claude as part of the AG-UI request and intercepted by
// the AG-UI client when Claude calls it.

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

const headlessCompleteAgent = new HttpAgent({
  url: `${AGENT_URL}/headless-complete`,
});

const runtime = new CopilotRuntime({
  // @ts-ignore -- Published CopilotRuntime agents type wraps Record in MaybePromise<NonEmptyRecord<...>> which rejects plain Records; fixed in source, pending release
  agents: { "headless-complete": headlessCompleteAgent },
});

export const POST = async (req: NextRequest) => {
  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit-headless-complete",
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
