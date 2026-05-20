// Dedicated runtime for the Agent Config Object demo.
//
// Hosts the `agent_config` ADK agent (mounted at /agent_config on the
// Python backend by agent_server.py). The frontend publishes its
// tone / expertise / responseLength toggles to the agent through
// `useAgentContext`, which the runtime serializes onto the AG-UI run as
// a context entry. The before-model callback on the Python side
// (src/agents/agent_config_agent.py) reads that entry off
// state["copilotkit"]["context"] and injects a derived directive block
// into the model's system instruction so the same single static prompt
// adapts its style to whatever the frontend currently has selected.
//
// References:
// - src/agents/agent_config_agent.py — the LlmAgent + before-model callback
// - src/app/demos/agent-config/config-context-relay.tsx — the
//   `useAgentContext` publisher

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

const agentConfigAgent = new HttpAgent({
  url: `${AGENT_URL}/agent_config`,
});

const agents: Record<string, HttpAgent> = {
  // The page's <CopilotKit agent="agent-config-demo"> resolves here.
  "agent-config-demo": agentConfigAgent,
  // Internal components (headless-chat, example-canvas) call `useAgent()`
  // with no args, which defaults to agentId "default". Alias to the same
  // agent so those component hooks resolve instead of throwing
  // "Agent 'default' not found".
  default: agentConfigAgent,
};

const runtime = new CopilotRuntime({
  // @ts-expect-error -- Published CopilotRuntime agents type wraps Record in
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
