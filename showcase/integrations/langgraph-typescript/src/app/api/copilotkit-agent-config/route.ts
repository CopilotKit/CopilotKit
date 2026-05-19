// Dedicated runtime for the Agent Config Object demo.
//
// Hosts the `agent_config_agent` graph. The frontend publishes its
// tone / expertise / responseLength toggles to the agent through
// `useAgentContext`, which the runtime serializes onto the AG-UI run as
// a context entry. The TypeScript LangGraph agent reads that context
// entry and adapts its style accordingly.
//
// References:
// - src/agent/agent-config.ts — the graph
// - src/app/demos/agent-config/config-context-relay.tsx — the
//   `useAgentContext` publisher

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { LangGraphAgent } from "@copilotkit/runtime/langgraph";

const LANGGRAPH_URL =
  process.env.LANGGRAPH_DEPLOYMENT_URL || "http://localhost:8123";

const agentConfigAgent = new LangGraphAgent({
  deploymentUrl: LANGGRAPH_URL,
  graphId: "agent_config_agent",
  langsmithApiKey: process.env.LANGSMITH_API_KEY || "",
});

const agents: Record<string, LangGraphAgent> = {
  // The page's <CopilotKit agent="agent-config-demo"> resolves here.
  "agent-config-demo": agentConfigAgent,
  // Internal components (headless-chat, example-canvas) call `useAgent()`
  // with no args, which defaults to agentId "default". Alias to the same
  // graph so those component hooks resolve instead of throwing
  // "Agent 'default' not found".
  default: agentConfigAgent,
};

const runtime = new CopilotRuntime({
  // @ts-ignore -- Published CopilotRuntime agents type wraps Record in
  // MaybePromise<NonEmptyRecord<...>> which rejects plain Records; fixed in
  // source, pending release.
  agents,
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
