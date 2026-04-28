// Dedicated runtime for the open-gen-ui and open-gen-ui-advanced demos.
// Both demos share this endpoint but differ on the agent name they pass via
// `<CopilotKit agent="...">`. Mirrors langgraph-python's /api/copilotkit-ogui.

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

const runtime = new CopilotRuntime({
  // @ts-expect-error -- see main route.ts
  agents: {
    "open-gen-ui": new HttpAgent({ url: `${AGENT_URL}/open_gen_ui` }),
    "open-gen-ui-advanced": new HttpAgent({
      url: `${AGENT_URL}/open_gen_ui_advanced`,
    }),
  },
  // The runtime's OpenGenerativeUIMiddleware turns each agent's streamed
  // `generateSandboxedUi` tool call into `open-generative-ui` activity
  // events that the provider's <CopilotKit openGenerativeUI={...}>
  // renderer mounts in a sandboxed iframe. Without this list, the
  // middleware never engages and the demo's iframe stays empty.
  openGenerativeUI: {
    agents: ["open-gen-ui", "open-gen-ui-advanced"],
  },
});

export const POST = async (req: NextRequest) => {
  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit-ogui",
      serviceAdapter: new ExperimentalEmptyAdapter(),
      runtime,
    });
    return await handleRequest(req);
  } catch (error: unknown) {
    console.error("[copilotkit-ogui]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
};
