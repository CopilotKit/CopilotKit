// Dedicated runtime for the /demos/agent-config cell.
//
// Proxies to the .NET backend's `/agent-config` endpoint, where a dedicated
// agent reads the forwarded tone / expertise / responseLength triple from
// shared state and rebuilds its system prompt per turn.
//
// References:
// - showcase/packages/ms-agent-dotnet/agent/AgentConfigAgent.cs
// - showcase/packages/ms-agent-dotnet/src/app/demos/agent-config/page.tsx

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

// The page mounts <CopilotKit agent="agent-config-demo" />; resolve that to
// the dedicated agent. `default` aliased so any internal default-agent
// lookups resolve against the same agent.
const agents: Record<string, AbstractAgent> = {
  "agent-config-demo": createAgent(),
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
