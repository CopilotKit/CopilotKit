// Dedicated runtime for the byoc-hashbrown demo (Wave 4a).
//
// The demo page (`src/app/demos/byoc-hashbrown/page.tsx`) wraps CopilotChat
// in the HashBrownDashboard provider and overrides the assistant message
// slot with a renderer that consumes hashbrown-shaped structured output via
// `@hashbrownai/react`'s `useUiKit` + `useJsonParser`. The agent behind this
// endpoint (`byoc_hashbrown_agent`) has a system prompt tuned to emit that
// shape — see `src/agents/byoc_hashbrown_agent.py`.
//
// Reference:
// - src/app/api/copilotkit-a2ui-fixed-schema/route.ts (topology this mirrors)
// - src/agents/byoc_hashbrown_agent.py (the backend graph)

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { LangGraphAgent } from "@copilotkit/runtime/langgraph";

const LANGGRAPH_URL =
  process.env.AGENT_URL ||
  process.env.LANGGRAPH_DEPLOYMENT_URL ||
  "http://localhost:8123";

const byocHashbrownAgent = new LangGraphAgent({
  deploymentUrl: LANGGRAPH_URL,
  graphId: "byoc_hashbrown",
  langsmithApiKey: process.env.LANGSMITH_API_KEY || "",
});

const agents: Record<string, LangGraphAgent> = {
  "byoc-hashbrown-demo": byocHashbrownAgent,
  // Internal components (headless-chat, example-canvas) call `useAgent()` with
  // no args, which defaults to agentId "default". Alias to the same graph so
  // those component hooks resolve instead of throwing "Agent 'default' not
  // found".
  default: byocHashbrownAgent,
};

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
  agents,
});

export const POST = async (req: NextRequest) => {
  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit-byoc-hashbrown",
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
