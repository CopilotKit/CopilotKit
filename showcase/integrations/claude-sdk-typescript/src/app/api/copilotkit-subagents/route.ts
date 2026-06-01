/**
 * Dedicated runtime for the Sub-Agents demo.
 *
 * Proxies to the Claude agent_server's `/subagents` endpoint, where a
 * supervisor LLM delegates to three specialized sub-agents
 * (research / writing / critique) — each implemented as a single
 * secondary Anthropic Messages API call with a sub-agent-specific
 * system prompt. Every delegation appends an entry to
 * `state.delegations` (running -> completed/failed) which the
 * agent_server emits via AG-UI `STATE_SNAPSHOT` so the UI's
 * delegation log updates live as the supervisor fans work out.
 */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { AbstractAgent, HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

const subagentsAgent = new HttpAgent({ url: `${AGENT_URL}/subagents` });

const agents: Record<string, AbstractAgent> = {
  subagents: subagentsAgent,
  default: subagentsAgent,
};

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts for type-hole notes
  agents,
});

export const POST = async (req: NextRequest) => {
  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit-subagents",
      serviceAdapter: new ExperimentalEmptyAdapter(),
      runtime,
    });
    return await handleRequest(req);
  } catch (error: unknown) {
    // Log full stack server-side, return only an opaque error id to the
    // client. Returning `error.message` / `error.stack` over the wire leaks
    // server internals (file paths, env-derived values, third-party stack
    // frames) to anyone who can hit this endpoint. Reference shape:
    // `mastra/src/app/api/copilotkit/route.ts` `logRouteError`.
    const err = error instanceof Error ? error : new Error(String(error));
    const errorId = randomUUID();
    console.error(
      JSON.stringify({
        at: new Date().toISOString(),
        level: "error",
        route: "/api/copilotkit-subagents",
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
