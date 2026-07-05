/**
 * Dedicated runtime for reasoning demos
 * (`reasoning-default`, `reasoning-custom`,
 * `tool-rendering-reasoning-chain`).
 *
 * Proxies to the OpenClaw gateway (pass-through). The gateway already emits
 * REASONING_MESSAGE_* events for reasoning-capable models, so the default
 * variant works without per-demo backend logic. (The reasoning-chain variant
 * — reasoning co-emitted with a tool call — depends on additional clawg-ui
 * support; see the demo roadmap.)
 */

import { NextRequest, NextResponse } from "next/server";
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
    const e = error as { message?: string; stack?: string };
    return NextResponse.json(
      { error: e.message, stack: e.stack },
      { status: 500 },
    );
  }
};
