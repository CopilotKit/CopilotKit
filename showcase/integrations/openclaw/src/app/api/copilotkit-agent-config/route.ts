/**
 * Dedicated runtime for the Agent Config Object demo.
 *
 * Proxies to the OpenClaw gateway (pass-through). The demo publishes its
 * typed config (tone / expertise / responseLength) via `useAgentContext`,
 * so it arrives as an AG-UI `context` entry on `RunAgentInput`. ag-ui
 * already injects context entries into the model prompt each turn (the same
 * path the readonly-state demo uses), so the agent adapts its behavior with
 * no per-demo backend logic.
 *
 * (Unlike the LangGraph reference there is no `RunnableConfig.configurable`
 * plumbing to bridge — context injection is the whole mechanism.)
 */

import type { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
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
    // Log the full error server-side under an opaque id; return only the id.
    // Returning error.message/stack leaks server internals (paths, versions,
    // env-derived values) to any caller. Matches copilotkit-subagents/route.ts.
    const err = error instanceof Error ? error : new Error(String(error));
    const errorId = randomUUID();
    console.error(
      JSON.stringify({
        at: new Date().toISOString(),
        level: "error",
        route: "/api/copilotkit-agent-config",
        errorId,
        message: err.message,
        stack: err.stack,
      }),
    );
    return NextResponse.json(
      { error: "internal runtime error", errorId },
      { status: 500 },
    );
  }
};
