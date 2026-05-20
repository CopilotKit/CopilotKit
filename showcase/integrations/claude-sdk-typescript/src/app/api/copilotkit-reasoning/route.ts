/**
 * Dedicated runtime for reasoning demos
 * (`agentic-chat-reasoning`, `reasoning-default-render`,
 * `tool-rendering-reasoning-chain`).
 *
 * Proxies to the Claude agent_server's `/reasoning` endpoint, which enables
 * Anthropic extended thinking and forwards `thinking_delta` events as AG-UI
 * REASONING_MESSAGE_* events. Model defaults to Claude 3.7 Sonnet — override
 * via `CLAUDE_REASONING_MODEL`.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { AbstractAgent, HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

function createReasoningAgent() {
  return new HttpAgent({ url: `${AGENT_URL}/reasoning` });
}

const agents: Record<string, AbstractAgent> = {
  "agentic-chat-reasoning": createReasoningAgent(),
  "reasoning-default-render": createReasoningAgent(),
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
