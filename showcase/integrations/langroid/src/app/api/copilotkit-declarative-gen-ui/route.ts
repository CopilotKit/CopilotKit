// Dedicated runtime for the Declarative Generative UI (A2UI) cell (Langroid).
//
// Option A (JS-runtime-injected A2UI): `injectA2UITool` defaults to true so
// the CopilotKit runtime middleware intercepts the agent's no-arg
// `generate_a2ui` toolcall and drives the secondary `render_a2ui` LLM pass
// itself, emitting `a2ui_operations` that the frontend renderer paints.
// The backend (see src/agents/agent.py -> GenerateA2UITool) wires a no-arg
// stub that raises loudly if called directly — the middleware should always
// intercept before it reaches Python.
//
// `defaultCatalogId` pins the catalog the page registers so the middleware's
// secondary-LLM pass uses the correct component set (models that follow the
// tool-usage guide and omit `catalogId` would otherwise fall back to the
// unregistered spec basic catalog, giving a "Catalog not found" render error).

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

const declarativeGenUiAgent = new HttpAgent({ url: `${AGENT_URL}/` });

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
  agents: { "declarative-gen-ui": declarativeGenUiAgent },
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
