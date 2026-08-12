// Dedicated runtime for the Declarative Generative UI (A2UI — Dynamic Schema)
// cell. The backend is the dedicated `a2ui_dynamic.py` agent mounted at
// `/declarative-gen-ui` (NOT the root catch-all `agent.py`): it wires a
// no-arg `generate_a2ui` tool stub. The CopilotKit runtime middleware
// (`a2ui.injectA2UITool: true`, enabled by default) intercepts the agent's
// `generate_a2ui` toolcall before it reaches Python and drives the secondary
// `render_a2ui` LLM pass itself, emitting `a2ui_operations` that the frontend
// renderer paints. This is Option A (JS-runtime-injected A2UI) — same
// pattern as the langgraph-python and crewai-crews siblings.
//
// `defaultCatalogId` pins the catalog the page registers so the middleware's
// secondary-LLM pass uses the correct component set (omitting `catalogId`
// falls back to the unregistered basic catalog → "Catalog not found" error).

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
  agents: {
    "declarative-gen-ui": new HttpAgent({
      url: `${AGENT_URL}/declarative-gen-ui/`,
    }),
  },
  a2ui: {
    // Pin the catalog the page registers so the middleware's secondary-LLM
    // pass uses the correct component set. Models that follow the tool-usage
    // guide and omit `catalogId` would otherwise fall back to the unregistered
    // basic catalog ("Catalog not found" render error).
    defaultCatalogId: "declarative-gen-ui-catalog",
  },
});

export const POST = async (req: NextRequest) => {
  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit-declarative-gen-ui",
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
