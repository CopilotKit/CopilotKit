// Dedicated runtime for the Agent Config Object demo.
//
// Proxies CopilotKit runtime requests to the MS Agent Framework backend's
// `/agent-config` endpoint, where `agent_config_agent.py` reads forwarded
// props (tone / expertise / responseLength) and rebuilds its system prompt
// per turn. Scoping to its own route + agent name keeps non-demo cells out
// of the dynamic-prompt path.
//
// References:
// - src/agents/agent_config_agent.py (backend graph)
// - src/app/demos/agent-config/page.tsx (provider properties source)

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { AbstractAgent, HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

function createAgent() {
  return new HttpAgent({ url: `${AGENT_URL}/agent-config` });
}

const agents: Record<string, AbstractAgent> = {
  // The page mounts <CopilotKit agent="agent-config-demo">.
  "agent-config-demo": createAgent(),
  // useAgent() with no args defaults to "default"; alias so internal lookups
  // resolve to the same agent.
  default: createAgent(),
};

export const POST = async (req: NextRequest) => {
  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit-agent-config",
      serviceAdapter: new ExperimentalEmptyAdapter(),
      runtime: new CopilotRuntime({
        // @ts-ignore -- Published CopilotRuntime agents type wraps Record in
        // MaybePromise<NonEmptyRecord<...>> which rejects plain Records;
        // fixed in source, pending release.
        agents,
      }),
    });
    return await handleRequest(req);
  } catch (error: unknown) {
    const err = error as Error;
    return NextResponse.json(
      { error: err.message, stack: err.stack },
      { status: 500 },
    );
  }
};
