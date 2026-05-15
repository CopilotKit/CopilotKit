// Dedicated runtime for the Declarative Generative UI (A2UI — Dynamic Schema) demo.
//
// Configured with `a2ui.injectA2UITool: false` — the Spring backend owns the
// `generate_a2ui` tool explicitly (see AgentConfig.java / GenerateA2uiTool.java).
// The A2UI middleware still serialises the registered catalog schema into
// `copilotkit.context` so the Spring-side secondary LLM inside
// `generate_a2ui` sees the catalog.

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { AbstractAgent, HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

function createAgent(): AbstractAgent {
  return new HttpAgent({ url: `${AGENT_URL}/` });
}

const agents: Record<string, AbstractAgent> = {
  "declarative-gen-ui": createAgent(),
};

export const POST = async (req: NextRequest) => {
  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit-declarative-gen-ui",
      serviceAdapter: new ExperimentalEmptyAdapter(),
      runtime: new CopilotRuntime({
        // @ts-ignore -- see main route.ts
        agents,
        a2ui: {
          injectA2UITool: false,
        },
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
