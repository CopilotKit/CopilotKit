// Dedicated runtime for the Declarative Generative UI (A2UI - Dynamic Schema)
// cell.
//
// `injectA2UITool` defaults to true. The dedicated backend Flow (see
// src/agents/declarative_gen_ui.py) forces the runtime-injected `render_a2ui`
// action, and the middleware turns that streamed tool call into the operations
// consumed by the frontend renderer.
//
// `defaultCatalogId` pins the catalog the page registers so the middleware's
// secondary-LLM pass uses the correct component set (models that follow the
// tool-usage guide and omit `catalogId` would otherwise fall back to the
// unregistered spec basic catalog, giving a "Catalog not found" render error).
//
// Agent URL points at the dedicated `/declarative-gen-ui` FastAPI endpoint
// mounted by `agent_server.py`, so this demo runs against its own Flow.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
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
    const copilotHandler = createCopilotRuntimeHandler({
      runtime,
      basePath: "/api/copilotkit-declarative-gen-ui",
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
