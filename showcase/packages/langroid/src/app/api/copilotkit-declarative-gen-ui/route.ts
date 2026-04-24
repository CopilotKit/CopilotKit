// Dedicated runtime for the Declarative Generative UI (A2UI) cell (Langroid).
//
// The unified Langroid agent already owns a `generate_a2ui` tool (see
// src/agents/agent.py -> GenerateA2UITool). We route this demo here so we
// can set `a2ui.injectA2UITool: false` — the runtime must NOT auto-inject
// its own A2UI tool on top of the agent-owned one.
//
// The A2UI middleware still runs: it serialises the registered client
// catalog into the agent's context so the secondary LLM inside
// `generate_a2ui` knows which components to emit.

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

const declarativeGenUiAgent = new HttpAgent({ url: `${AGENT_URL}/` });

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
  agents: { "declarative-gen-ui": declarativeGenUiAgent },
  a2ui: {
    injectA2UITool: false,
  },
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
