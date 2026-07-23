import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { AbstractAgent } from "@ag-ui/client";
import { HermesAgent } from "@ag-ui/hermes";

// Dedicated runtime for the Open Generative UI demos (open-gen-ui +
// open-gen-ui-advanced).
//
// Isolated here — mirroring langgraph-python's copilotkit-ogui route —
// because the `openGenerativeUI` runtime flag sets
// `openGenerativeUIEnabled: true` globally on the probe response, which
// causes the CopilotKit provider's setTools effect to wipe per-demo
// `useFrontendTool`/`useComponent` registrations in the DEFAULT runtime.
// Keeping OGUI on its own route protects the 27 green demos on
// /api/copilotkit.
//
// Hermes serves every run from a single AG-UI endpoint (POST /) on :8000,
// so both agent names map to the same HttpAgent at the root URL. The
// `openGenerativeUI: { agents: [...] }` flag turns on the
// OpenGenerativeUIMiddleware for the listed agents: the frontend
// auto-registers a `generateSandboxedUi` tool (when the provider gets an
// `openGenerativeUI` prop), the agent emits it (driven by the aimock
// fixture), and the runtime middleware converts that streamed tool call
// into `open-generative-ui` activity events that the built-in
// OpenGenerativeUIActivityRenderer mounts inside a sandboxed iframe.

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

function createAgent() {
  return new HermesAgent({ url: `${AGENT_URL}/` });
}

const agents: Record<string, AbstractAgent> = {
  "open-gen-ui": createAgent(),
  "open-gen-ui-advanced": createAgent(),
};

export const POST = async (req: NextRequest) => {
  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit-ogui",
      serviceAdapter: new ExperimentalEmptyAdapter(),
      runtime: new CopilotRuntime({
        // @ts-ignore -- see main route.ts
        agents,
        openGenerativeUI: {
          agents: ["open-gen-ui", "open-gen-ui-advanced"],
        },
      }),
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
