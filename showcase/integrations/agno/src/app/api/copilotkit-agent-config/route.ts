// Dedicated runtime for the Agent Config Object demo (Agno).
//
// The page publishes preferences through useAgentContext. This route maps
// that context to the forwarded properties consumed by Agno's per-request
// factory at `/agent-config/agui` (see `src/agent_server.py::_run_agent_config`).
//
// Scoped to its own endpoint so non-demo cells don't pay the cost of the
// per-request agent factory and so the request-body propagation can be
// asserted against exactly one URL.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

const PREFERENCES_DESCRIPTION =
  "Agent response preferences. Apply tone, expertise level, and response length to every reply.";

class AgentConfigHttpAgent extends HttpAgent {
  run(input: Parameters<HttpAgent["run"]>[0]): ReturnType<HttpAgent["run"]> {
    const preferences: Record<string, string> = {};
    for (const entry of input.context) {
      if (entry.description !== PREFERENCES_DESCRIPTION) continue;

      let value: unknown;
      try {
        value = JSON.parse(entry.value);
      } catch {
        // Malformed context must not discard valid legacy properties.
        continue;
      }
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;

      for (const [key, preference] of Object.entries(value)) {
        if (
          (key === "tone" || key === "expertise" || key === "responseLength") &&
          typeof preference === "string"
        ) {
          preferences[key] = preference;
        }
      }
    }

    if (Object.keys(preferences).length === 0) return super.run(input);

    // Keep backend enum validation authoritative. Only current preferences
    // override legacy values; all other run data and properties pass through.
    return super.run({
      ...input,
      forwardedProps: { ...input.forwardedProps, ...preferences },
    });
  }
}

const agentConfigAgent = new AgentConfigHttpAgent({
  url: `${AGENT_URL}/agent-config/agui`,
});

const runtime = new CopilotRuntime({
  agents: {
    // @ts-ignore -- see main route.ts
    "agent-config-demo": agentConfigAgent,
    // @ts-ignore -- see main route.ts
    default: agentConfigAgent,
  },
});

export const POST = async (req: NextRequest) => {
  try {
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
