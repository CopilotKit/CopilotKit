// Dedicated runtime for the Sub-Agents demo (Langroid).
//
// Routes to POST /subagents on the FastAPI agent server, which runs a
// supervisor LLM that delegates to three specialized sub-agents
// (research / writing / critique). Each delegation is recorded into
// state["delegations"] and surfaced to the UI via STATE_SNAPSHOT events
// so the live delegation log can render running -> completed transitions.

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";
import crypto from "node:crypto";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

const subagentsAgent = new HttpAgent({
  url: `${AGENT_URL}/subagents`,
});

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
  agents: {
    subagents: subagentsAgent,
    default: subagentsAgent,
  },
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
    // Log full error details server-side (with a correlation id) but do
    // NOT leak `error.message` / `error.stack` to the client — those can
    // contain internal paths, library internals, or transient secrets.
    // Operators correlate via `errorId` in logs.
    const errorId = crypto.randomUUID();
    const e = error instanceof Error ? error : new Error(String(error));
    console.error(
      JSON.stringify({
        at: new Date().toISOString(),
        level: "error",
        route: "/api/copilotkit-subagents",
        errorId,
        message: e.message,
        stack: e.stack,
      }),
    );
    return NextResponse.json(
      { error: "internal runtime error", errorId },
      { status: 500 },
    );
  }
};
