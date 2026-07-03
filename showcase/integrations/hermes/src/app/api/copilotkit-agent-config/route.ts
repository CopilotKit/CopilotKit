// Dedicated runtime for the agent-config demo.
//
// The demo page (`src/app/demos/agent-config/page.tsx`) forwards typed
// config knobs (tone / expertise / responseLength) to the agent via the v2
// `useAgentContext` hook — the same AG-UI `context[]` channel the
// readonly-state demo uses. The hermes AG-UI adapter renders
// `RunAgentInput.context` into a read-only system message
// (translate.context_to_text) so the agent's reply reflects the current
// config. Hermes serves every run from a single AG-UI endpoint, so this
// proxies to the same HttpAgent as the main route; only the runtime
// endpoint + registered agent name (`agent-config-demo`) differ. Matching
// langgraph-python's dedicated `/api/copilotkit-agent-config` route.

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { HermesAgent } from "@ag-ui/hermes";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
  agents: {
    "agent-config-demo": new HermesAgent({ url: `${AGENT_URL}/` }),
  },
});

export const POST = async (req: NextRequest) => {
  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit-agent-config",
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
