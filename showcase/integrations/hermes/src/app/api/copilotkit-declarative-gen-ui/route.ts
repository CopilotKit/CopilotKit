// Dedicated runtime for the Declarative Generative UI (A2UI — Dynamic Schema)
// cell.
//
// Mirrors langgraph-python's copilotkit-declarative-gen-ui route and
// pydantic-ai's copilotkit-declarative-gen-ui route, adapted for the hermes
// AG-UI transport. Splitting into its own endpoint (like copilotkit-ogui)
// keeps the A2UI middleware off the default /api/copilotkit route so it
// cannot interfere with the 30 green demos there.
//
// Hermes has no A2UI backend: the aimock-driven agent is generic. With the
// page's `<CopilotKit a2ui={{ catalog }}>` prop, the runtime A2UI middleware
// (@ag-ui/a2ui-middleware) attaches to the per-request agent clone, injects a
// `render_a2ui` tool into the agent's toolset, and serialises the registered
// catalog into the agent context. The aimock fixture then makes the agent EMIT
// `render_a2ui` with the flat A2UI components payload; the middleware detects
// that streamed tool call and forwards the surface to the frontend, which
// materialises it from the registered catalog. `defaultCatalogId` pins the
// catalog id the page registers so surfaces resolve even when the emitted args
// omit `catalogId`.
//
// Reference:
// - integrations/langgraph-python/src/app/api/copilotkit-declarative-gen-ui/route.ts
// - integrations/pydantic-ai/src/app/api/copilotkit-declarative-gen-ui/route.ts
// - integrations/hermes/src/app/api/copilotkit-ogui/route.ts (hermes topology)

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { AbstractAgent } from "@ag-ui/client";
import { HermesAgent } from "@ag-ui/hermes";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

function createAgent() {
  return new HermesAgent({ url: `${AGENT_URL}/` });
}

const agents: Record<string, AbstractAgent> = {
  "declarative-gen-ui": createAgent(),
};

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts (published CopilotRuntime agents type)
  agents,
  a2ui: {
    // The page passes a catalog via `<CopilotKit a2ui={{ catalog }}>`, which
    // auto-enables A2UI and defaults `injectA2UITool` on — so the middleware
    // injects `render_a2ui` and the (aimock-driven) agent emits it directly.
    // Pin the catalog the page registers so surfaces resolve even when the
    // emitted args omit `catalogId`.
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
