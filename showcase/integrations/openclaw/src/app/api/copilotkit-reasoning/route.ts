/**
 * Dedicated runtime for reasoning demos
 * (`reasoning-default`, `reasoning-custom`,
 * `tool-rendering-reasoning-chain`).
 *
 * Proxies to the OpenClaw gateway (pass-through). The gateway already emits
 * REASONING_MESSAGE_* events for reasoning-capable models, so the default
 * variant works without per-demo backend logic. (The reasoning-chain variant
 * — reasoning co-emitted with a tool call — depends on additional ag-ui
 * support; see the demo roadmap.)
 */

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { AbstractAgent } from "@ag-ui/client";
import { createGatewayAgent } from "@/lib/openclaw-agent";

function createReasoningAgent() {
  return createGatewayAgent();
}

const agents: Record<string, AbstractAgent> = {
  "reasoning-default": createReasoningAgent(),
  "reasoning-custom": createReasoningAgent(),
  "tool-rendering-reasoning-chain": createReasoningAgent(),
  default: createReasoningAgent(),
};

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
  agents,
});

export const POST = async (req: NextRequest) => {
  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit-reasoning",
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
        route: "/api/copilotkit-reasoning",
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
