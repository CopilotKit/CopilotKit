/**
 * Dedicated runtime for the Shared State (Read + Write) demo.
 *
 * Proxies to the Claude agent_server's `/shared-state-read-write`
 * endpoint, which reads `input.state.preferences` (written by the UI
 * via `agent.setState`) into the system prompt every turn and exposes
 * a `set_notes` tool that mutates `state.notes`. The agent_server
 * emits AG-UI `STATE_SNAPSHOT` events for both directions so the UI's
 * `useAgent({ updates: [OnStateChanged] })` hook re-renders the
 * sidebar in real time.
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

const sharedStateAgent = new HttpAgent({
  url: `${AGENT_URL}/shared-state-read-write`,
});

const agents: Record<string, AbstractAgent> = {
  "shared-state-read-write": sharedStateAgent,
  default: sharedStateAgent,
};

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts for type-hole notes
  agents,
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
        route: "/api/copilotkit-shared-state-read-write",
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
