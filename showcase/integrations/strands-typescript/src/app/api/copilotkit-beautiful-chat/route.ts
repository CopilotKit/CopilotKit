// Dedicated runtime for the Beautiful Chat flagship showcase cell (Strands).
//
// Beautiful Chat exercises Open Generative UI and MCP Apps. (The Python
// sibling additionally wires A2UI here; this TypeScript integration ships
// the base, non-A2UI demo set, so that catalog is omitted.) The shared
// Strands TS backend hosts a single Strands Agent on "/", so the cell routes
// there; the flagship behavior comes from the runtime flags plus the
// frontend's per-cell registrations.
//
// Isolated on its own endpoint because the `openGenerativeUI` runtime flag
// sets global state on the probe response that would otherwise leak into the
// other cells sharing the default `/api/copilotkit` runtime.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

function createAgent() {
  return new HttpAgent({ url: `${AGENT_URL}/` });
}

// The beautiful-chat page resolves <CopilotKit agent="beautiful-chat">
// here; internal components (headless-chat, example-canvas) also call
// `useAgent()` with no args, which defaults to agentId "default". Alias
// default to the same backend so those hooks resolve.
const beautifulChatAgent = createAgent();
const agents = {
  "beautiful-chat": beautifulChatAgent,
  default: beautifulChatAgent,
};

const runtime = new CopilotRuntime({
  // @ts-ignore -- Published CopilotRuntime agents type wraps Record in MaybePromise<NonEmptyRecord<...>> which rejects plain Records; fixed in source, pending release
  agents,
  openGenerativeUI: true,
  // NOTE: the Python sibling additionally wires `a2ui` here. This TypeScript
  // integration ships the base (non-A2UI) demo set, so the A2UI runtime
  // config is intentionally omitted.
});

export const POST = async (req: NextRequest) => {
  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit-beautiful-chat",
      serviceAdapter: new ExperimentalEmptyAdapter(),
      runtime,
    });
    return await handleRequest(req);
  } catch (error: unknown) {
    const e = error as { message?: string; stack?: string };
    console.error(
      `[copilotkit-beautiful-chat/route] ERROR: ${e.message}`,
      e.stack,
    );
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
};
