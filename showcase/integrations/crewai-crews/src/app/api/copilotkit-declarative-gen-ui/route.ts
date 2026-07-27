// Dedicated runtime for the Declarative Generative UI (A2UI - Dynamic Schema)
// cell.
//
// Option A (JS-runtime-injected A2UI): `injectA2UITool` defaults to true so
// the CopilotKit runtime middleware intercepts the agent's no-arg
// `generate_a2ui` toolcall and drives the secondary `render_a2ui` LLM pass
// itself, emitting `a2ui_operations` that the frontend renderer paints.
// The backend crew (see src/agents/declarative_gen_ui.py) wires a no-arg
// `generate_a2ui` tool that raises loudly if called directly — the
// middleware should always intercept before it reaches Python.
//
// `defaultCatalogId` pins the catalog the page registers so the middleware's
// secondary-LLM pass uses the correct component set (models that follow the
// tool-usage guide and omit `catalogId` would otherwise fall back to the
// unregistered spec basic catalog, giving a "Catalog not found" render error).
//
// Agent URL points at the dedicated `/declarative-gen-ui` FastAPI endpoint
// mounted by `agent_server.py`, so this demo runs against its own crew
// rather than the shared `LatestAiDevelopment` crew on "/".

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import type { AbstractAgent } from "@ag-ui/client";
import { HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

function createAgent() {
  return new HttpAgent({ url: `${AGENT_URL}/declarative-gen-ui` });
}

const agents: Record<string, AbstractAgent> = {
  "declarative-gen-ui": createAgent(),
  default: createAgent(),
};

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
  agents,
  a2ui: {
    // Models follow the tool-usage guide and omit `catalogId`, and the
    // middleware then falls back to the unregistered spec basic catalog
    // ("Catalog not found" render error). Pin the catalog the page registers.
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
