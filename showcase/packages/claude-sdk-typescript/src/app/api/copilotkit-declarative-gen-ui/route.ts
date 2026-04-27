// Dedicated runtime for the Declarative Generative UI (A2UI) cell.
// The A2UI middleware injects a `render_a2ui` tool into every request.
// The Claude pass-through agent receives it via AG-UI and invokes it
// against the page-registered catalog on the provider.

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
  agents: { "declarative-gen-ui": new HttpAgent({ url: `${AGENT_URL}/` }) },
  // `injectA2UITool` defaults to true — Claude receives the runtime-injected
  // `render_a2ui` tool and calls it to emit A2UI operations.
});

export const POST = async (req: NextRequest) => {
  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit-declarative-gen-ui",
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
