// Dedicated runtime for the Agent Config Object demo.
//
// Routes to the Spring /agent-config/run endpoint which reads
// forwardedProps (tone, expertise, responseLength) off the AG-UI envelope
// and rebuilds the SpringAIAgent's system prompt per request.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import type { AbstractAgent } from "@ag-ui/client";
import { HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

function createAgent(): AbstractAgent {
  return new HttpAgent({ url: `${AGENT_URL}/agent-config/run` });
}

const agentConfigAgent = createAgent();
const agents: Record<string, AbstractAgent> = {
  "agent-config-demo": agentConfigAgent,
  default: agentConfigAgent,
};

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
  agents,
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
