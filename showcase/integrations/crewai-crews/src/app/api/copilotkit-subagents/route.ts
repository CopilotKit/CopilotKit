// Dedicated runtime for the Sub-Agents cell.
//
// Backend: a CrewAI `Flow` mounted at `/subagents` on the FastAPI agent
// server. The flow exposes three real CrewAI `Crew`s (research, writing,
// critique) as supervisor tool calls, runs them via `Crew.kickoff()`,
// and emits STATE_SNAPSHOT events for each delegation so the UI's
// delegation log fills in live as the supervisor fans work out.
//
// See `src/agents/subagents.py` for the full architecture rationale on
// why this is a Flow + tool-driven supervisor rather than a single
// hierarchical Crew (CrewAI's hierarchical Process surfaces only the
// final crew output through the AG-UI bridge, with no per-delegation
// visibility for the frontend).

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { AbstractAgent, HttpAgent } from "@ag-ui/client";
import crypto from "node:crypto";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

function createAgent() {
  return new HttpAgent({ url: `${AGENT_URL}/subagents` });
}

const agents: Record<string, AbstractAgent> = {
  subagents: createAgent(),
  default: createAgent(),
};

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
  agents,
});

// Log a structured error with a correlation id and return the id so the
// HTTP response can surface it without leaking message/stack contents to
// the client. Mirrors `mastra/src/app/api/copilotkit/route.ts`.
function logRouteError(err: unknown): string {
  const error = err instanceof Error ? err : new Error(String(err));
  const errorId = crypto.randomUUID();
  console.error(
    JSON.stringify({
      at: new Date().toISOString(),
      level: "error",
      route: "copilotkit-subagents",
      errorId,
      message: error.message,
      stack: error.stack,
    }),
  );
  return errorId;
}

export const POST = async (req: NextRequest) => {
  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit-subagents",
      serviceAdapter: new ExperimentalEmptyAdapter(),
      runtime,
    });
    return await handleRequest(req);
  } catch (error: unknown) {
    const errorId = logRouteError(error);
    return NextResponse.json(
      { error: "internal runtime error", errorId },
      { status: 500 },
    );
  }
};
