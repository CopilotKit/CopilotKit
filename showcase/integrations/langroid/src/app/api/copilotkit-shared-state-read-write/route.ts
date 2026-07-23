// Dedicated runtime for the Shared State (Read + Write) demo (Langroid).
//
// The unified Langroid agent at POST / does not consume RunAgentInput.state
// or emit STATE_SNAPSHOT events. The shared-state-read-write demo needs
// both — UI -> agent writes via agent.setState, agent -> UI writes via
// the `set_notes` tool — so we point this runtime at a dedicated FastAPI
// endpoint (POST /shared-state-read-write) that implements its own AG-UI
// SSE pipeline with full state support.

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";
import crypto from "node:crypto";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

const sharedStateReadWriteAgent = new HttpAgent({
  url: `${AGENT_URL}/shared-state-read-write`,
});

const runtime = new CopilotRuntime({
  // @ts-ignore -- Published CopilotRuntime agents type wraps Record in
  // MaybePromise<NonEmptyRecord<...>> which rejects plain Records; same
  // workaround as the main route.ts.
  agents: {
    "shared-state-read-write": sharedStateReadWriteAgent,
    default: sharedStateReadWriteAgent,
  },
});

export const POST = async (req: NextRequest) => {
  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit-shared-state-read-write",
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
        route: "/api/copilotkit-shared-state-read-write",
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
