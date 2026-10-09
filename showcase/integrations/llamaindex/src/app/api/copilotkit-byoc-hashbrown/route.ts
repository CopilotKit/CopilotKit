// Dedicated runtime for the BYOC Hashbrown demo.
//
// The backend agent emits a `<ui>...</ui>` envelope that `@hashbrownai/react`
// parses progressively. The runtime just proxies to the LlamaIndex agent at
// the /byoc-hashbrown subpath.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import type { AbstractAgent } from "@ag-ui/client";
import { HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

const byocHashbrownAgent = new HttpAgent({
  url: `${AGENT_URL}/byoc-hashbrown/run`,
});

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
  agents: { "byoc-hashbrown-demo": byocHashbrownAgent as AbstractAgent },
});

export const POST = async (req: NextRequest) => {
  try {
    const copilotHandler = createCopilotRuntimeHandler({
      runtime,
      basePath: "/api/copilotkit-byoc-hashbrown",
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
