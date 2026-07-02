// Dedicated runtime for the reasoning demos (reasoning-default + reasoning-custom).
//
// aimock only streams `reasoning_content` deltas for reasoning-capable model
// families — gpt-4o (the main :8000 backend's model) is in aimock's
// NONREASONING_FAMILIES and gets suppressed. So the reasoning demos are served
// by a SECOND Hermes AG-UI backend that the container's entrypoint.sh starts on
// :8001 with HERMES_AGUI_MODEL=gpt-5-mini (a reasoning family). This mirrors
// langgraph-python's dedicated reasoning graph (`reasoning_agent.py`, which
// runs on a reasoning model via the Responses API). The main :8000 backend
// stays on gpt-4o, unchanged, for the 15 existing green demos.
//
// Hermes serves every run from a single AG-UI endpoint (POST /), so both
// reasoning agent names map to the same HttpAgent at the :8001 root URL; only
// the runtime endpoint + registered agent names differ from the main route.

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";

// The reasoning backend runs in the same container on :8001 (see entrypoint.sh).
const REASONING_AGENT_URL =
  process.env.REASONING_AGENT_URL || "http://localhost:8001";

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
  agents: {
    "reasoning-default": new HttpAgent({ url: `${REASONING_AGENT_URL}/` }),
    "reasoning-custom": new HttpAgent({ url: `${REASONING_AGENT_URL}/` }),
    // tool-rendering-reasoning-chain composes reasoning (from this :8001
    // gpt-5-mini backend) with client-executed frontend tools. It routes
    // here so aimock streams reasoning_content and the adapter emits
    // REASONING_MESSAGE_* events; the tools are executed client-side, so
    // this backend just needs to loop the tool calls the fixture emits.
    "tool-rendering-reasoning-chain": new HttpAgent({
      url: `${REASONING_AGENT_URL}/`,
    }),
  },
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
