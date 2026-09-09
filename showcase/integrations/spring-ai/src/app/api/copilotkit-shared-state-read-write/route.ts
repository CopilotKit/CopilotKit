// Dedicated runtime for the Shared State (Read + Write) demo.
//
// Routes to the Spring `/shared-state-read-write/run` endpoint, which runs a
// per-request `LocalAgent` subclass that reads `preferences` off AG-UI state
// to compose its system prompt and exposes a `set_notes` tool that mutates
// the `notes` slot of state and emits a STATE_SNAPSHOT back to the frontend.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import type { AbstractAgent } from "@ag-ui/client";
import { HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

function createAgent(): AbstractAgent {
  return new HttpAgent({ url: `${AGENT_URL}/shared-state-read-write/run` });
}

const sharedStateAgent = createAgent();
const agents: Record<string, AbstractAgent> = {
  "shared-state-read-write": sharedStateAgent,
  default: sharedStateAgent,
};

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
  agents,
});

export const POST = async (req: NextRequest) => {
  try {
    const copilotHandler = createCopilotRuntimeHandler({
      runtime,
      basePath: "/api/copilotkit-shared-state-read-write",
      mode: "single-route",
    });
    return await copilotHandler(req);
  } catch (error: unknown) {
    const e = error as { message?: string; stack?: string };
    return NextResponse.json(
      { error: e.message, stack: e.stack },
      { status: 500 },
    );
  }
};
