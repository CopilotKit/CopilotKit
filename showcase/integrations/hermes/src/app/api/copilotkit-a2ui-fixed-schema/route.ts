// Dedicated runtime for the A2UI — Fixed Schema cell.
//
// Mirrors langgraph-python's copilotkit-a2ui-fixed-schema route, adapted for
// the hermes AG-UI transport. In langgraph the backend `display_flight` tool
// emits an `a2ui_operations` container that the A2UI middleware detects in the
// AGENT tool result (`injectA2UITool: false`). Hermes has no A2UI backend and
// a generic aimock agent cannot emit an agent-side tool RESULT that the
// middleware would see (client-executed tool results are request input, not
// agent output), so we use the same middleware-injected `render_a2ui` path as
// the declarative demo: the page's `<CopilotKit a2ui={{ catalog }}>` prop
// auto-enables A2UI with injectA2UITool defaulting on, the middleware injects
// `render_a2ui`, and the aimock agent EMITS it with the FIXED flight schema as
// `components` + the flight `data` model. Path bindings (`{ path: "/origin" }`)
// in the fixed schema resolve against that data — preserving the fixed-schema
// "pre-authored tree, streamed data" semantics within a single render call.
// `defaultCatalogId` pins the flight catalog the page registers.
//
// Reference:
// - integrations/langgraph-python/src/app/api/copilotkit-a2ui-fixed-schema/route.ts
// - integrations/hermes/src/app/api/copilotkit-declarative-gen-ui/route.ts

import { NextRequest, NextResponse } from "next/server";
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
  "a2ui-fixed-schema": createAgent(),
};

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
  agents,
  a2ui: {
    // Middleware-injected render path: the agent emits `render_a2ui` with the
    // fixed flight schema as components + the flight data model. Pin the flight
    // catalog the page registers so the schema's component names resolve even
    // when the emitted args omit `catalogId`.
    defaultCatalogId: "copilotkit://flight-fixed-catalog",
  },
});

export const POST = async (req: NextRequest) => {
  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit-a2ui-fixed-schema",
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
