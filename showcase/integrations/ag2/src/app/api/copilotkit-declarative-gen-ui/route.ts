// Dedicated runtime for the Declarative Generative UI (A2UI — Dynamic Schema)
// cell. Mirrors the working claude-sdk-typescript reference pattern: the
// backend is the default pass-through ConversableAgent, and the runtime
// auto-injects the `render_a2ui` tool (injectA2UITool defaults to true).
// The A2UI middleware serialises the registered client catalog into
// `copilotkit.context` and detects `a2ui_operations` in the tool result,
// streaming rendered surfaces to the frontend.

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
  // `injectA2UITool` defaults to true — the runtime injects the A2UI tool
  // and the default ConversableAgent receives it via AG-UI, matching the
  // working claude-sdk-typescript reference pattern.
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
