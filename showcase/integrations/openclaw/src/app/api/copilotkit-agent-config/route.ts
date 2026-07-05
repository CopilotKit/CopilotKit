/**
 * Dedicated runtime for the Agent Config Object demo.
 *
 * Proxies to the OpenClaw gateway (pass-through). The demo publishes its
 * typed config (tone / expertise / responseLength) via `useAgentContext`,
 * so it arrives as an AG-UI `context` entry on `RunAgentInput`. clawg-ui
 * already injects context entries into the model prompt each turn (the same
 * path the readonly-state demo uses), so the agent adapts its behavior with
 * no per-demo backend logic.
 *
 * (Unlike the LangGraph reference there is no `RunnableConfig.configurable`
 * plumbing to bridge — context injection is the whole mechanism.)
 */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { AbstractAgent } from "@ag-ui/client";
import { createGatewayAgent } from "@/lib/openclaw-agent";

const agentConfigAgent = createGatewayAgent();

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
