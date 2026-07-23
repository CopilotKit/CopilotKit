// Dedicated runtime for the reasoning demos (reasoning-default + reasoning-custom).
//
// The whole showcase now runs on a SINGLE Hermes AG-UI backend on :8000 with
// HERMES_AGUI_MODEL=gpt-5-mini (a reasoning-capable family). aimock streams
// `reasoning_content` deltas for reasoning families and only when the fixture
// declares a `reasoning` channel, so the reasoning demos get REASONING_MESSAGE_*
// events while the non-reasoning demos stay unaffected on the same backend. This
// route stays separate only for its distinct endpoint + registered agent names.
//
// Hermes serves every run from a single AG-UI endpoint (POST /), so both
// reasoning agent names map to the same HttpAgent at the :8000 root URL; only
// the runtime endpoint + registered agent names differ from the main route.

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { HermesAgent } from "@ag-ui/hermes";

// The single Hermes backend runs in the same container on :8000 (see
// entrypoint.sh) — same URL as the main copilotkit route.
const REASONING_AGENT_URL =
  process.env.REASONING_AGENT_URL ||
  process.env.AGENT_URL ||
  "http://localhost:8000";

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
  agents: {
    "reasoning-default": new HermesAgent({ url: `${REASONING_AGENT_URL}/` }),
    "reasoning-custom": new HermesAgent({ url: `${REASONING_AGENT_URL}/` }),
    // tool-rendering-reasoning-chain composes reasoning (from the single
    // gpt-5-mini backend) with client-executed frontend tools. It routes
    // here so aimock streams reasoning_content and the adapter emits
    // REASONING_MESSAGE_* events; the tools are executed client-side, so
    // this backend just needs to loop the tool calls the fixture emits.
    "tool-rendering-reasoning-chain": new HermesAgent({
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
