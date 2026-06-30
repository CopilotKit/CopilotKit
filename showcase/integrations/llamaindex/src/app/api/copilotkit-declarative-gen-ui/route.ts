// Dedicated runtime for the Declarative Generative UI (A2UI — Dynamic Schema)
// cell. Mirrors `langgraph-python/src/app/api/copilotkit-declarative-gen-ui/`.
//
// The backend agent (src/agents/a2ui_dynamic.py) owns a `generate_a2ui` tool
// explicitly, but the surface is mounted by the A2UI middleware from a STREAMED
// `render_a2ui` tool-CALL (TOOL_CALL_START name=render_a2ui → TOOL_CALL_ARGS
// carrying the components JSON → TOOL_CALL_END) that the agent synthesises on
// the outbound AG-UI stream. `@ag-ui/a2ui-middleware` only mounts the surface
// when it WATCHES that tool-call name, and the watched-names set is populated
// when `injectA2UITool: true`. So we set it true here (the agent does not bind a
// frontend `render_a2ui` tool itself — it only emits the streamed call — so the
// injected/watched tool does not collide with anything).

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

const declarativeGenUiAgent = new HttpAgent({
  url: `${AGENT_URL}/a2ui-dynamic/run`,
});

const runtime = new CopilotRuntime({
  // @ts-ignore -- CopilotRuntime agents type wraps Record in MaybePromise<NonEmptyRecord<...>>
  agents: { "declarative-gen-ui": declarativeGenUiAgent as AbstractAgent },
  a2ui: {
    injectA2UITool: true,
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
