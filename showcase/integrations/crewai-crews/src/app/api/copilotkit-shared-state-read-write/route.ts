// Dedicated runtime for the Shared State (Read + Write) cell.
//
// Backend: a CrewAI `Flow` (NOT a Crew) mounted at
// `/shared-state-read-write` on the FastAPI agent server. The flow owns
// the `set_notes` tool and emits STATE_SNAPSHOT events on every tool
// call so the UI's `useAgent` subscription sees live updates of
// `state.notes` without waiting for the next turn. See
// `src/agents/shared_state_read_write.py` for the full rationale on why
// this demo cannot share the `LatestAiDevelopment` crew on "/".

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
  return new HttpAgent({ url: `${AGENT_URL}/shared-state-read-write` });
}

const agents: Record<string, AbstractAgent> = {
  "shared-state-read-write": createAgent(),
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
      route: "copilotkit-shared-state-read-write",
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
      endpoint: "/api/copilotkit-shared-state-read-write",
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
