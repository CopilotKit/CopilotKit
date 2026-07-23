/**
 * Dedicated runtime for reasoning demos
 * (`reasoning-default`, `reasoning-custom`,
 * `tool-rendering-reasoning-chain`).
 *
 * Proxies to the Claude agent_server's `/reasoning` endpoint, which enables
 * Anthropic extended thinking and forwards `thinking_delta` events as AG-UI
 * REASONING_MESSAGE_* events. Model defaults to Claude 3.7 Sonnet — override
 * via `CLAUDE_REASONING_MODEL`.
 */

import type { NextRequest } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import type { AbstractAgent } from "@ag-ui/client";
import { createClaudeHttpAgent } from "@/app/api/_shared/claude-http-agent";
import { internalRuntimeErrorResponse } from "@/app/api/_shared/route-error";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

function createReasoningAgent() {
  return createClaudeHttpAgent(`${AGENT_URL}/reasoning`);
}

const agents: Record<string, AbstractAgent> = {
  "reasoning-default": createReasoningAgent(),
  "reasoning-custom": createReasoningAgent(),
  // Reasoning-chain owns its tools backend-side (get_stock_price,
  // roll_dice, search_flights, get_weather) — the page registers
  // render-only hooks, so the plain /reasoning pass-through stalled the
  // chain after the first call (no tool result ever came back). The
  // dedicated endpoint runs the agentic loop with extended thinking.
  "tool-rendering-reasoning-chain": createClaudeHttpAgent(
    `${AGENT_URL}/tool-rendering-reasoning-chain`,
  ),
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
    return internalRuntimeErrorResponse("/api/copilotkit-reasoning", error);
  }
};
