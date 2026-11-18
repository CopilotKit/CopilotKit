// Dedicated runtime for the Agent Config Object demo.
//
// Hosts the `agent-config-demo` agent. The frontend publishes its
// tone / expertise / responseLength toggles to the agent through
// `useAgentContext`, which the runtime serializes onto the AG-UI run as
// a context entry. The adapter appends that entry to the agent's
// instructions before every model call, after the static rulebook.
//
// References:
// - src/demo_agents/agent_config.py — the agent
// - src/app/demos/agent-config/config-context-relay.tsx — the
//   `useAgentContext` publisher

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";
import { extractForwardedHeaders } from "@/lib/header-forwarding";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

export const POST = async (req: NextRequest) => {
  try {
    const headers = extractForwardedHeaders(req);
    const agentConfigAgent = new HttpAgent({
      url: `${AGENT_URL}/agent-config-demo`,
      headers,
    });

    const runtime = new CopilotRuntime({
      agents: {
        // The page's <CopilotKit agent="agent-config-demo"> resolves here.
        "agent-config-demo": agentConfigAgent,
        // Internal components call `useAgent()` with no args, which
        // defaults to agentId "default". Alias to the same agent so those
        // hooks resolve instead of throwing "Agent 'default' not found".
        default: agentConfigAgent,
      },
    });

    const copilotHandler = createCopilotRuntimeHandler({
      runtime,
      basePath: "/api/copilotkit-agent-config",
      mode: "single-route",
    });

    return await copilotHandler(req);
  } catch (error: unknown) {
    const e = error as { message?: string; stack?: string };
    return NextResponse.json(
      { error: e.message, stack: e.stack },
      { status: 500 },
    );
  }
};
