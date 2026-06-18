// Dedicated runtime for the Declarative Generative UI (A2UI — Dynamic Schema)
// cell. Mirrors `langgraph-python/src/app/api/copilotkit-declarative-gen-ui/`.
//
// The backend agent (src/agents/a2ui_dynamic.py) owns the `generate_a2ui`
// tool explicitly, so `a2ui.injectA2UITool: false` prevents the runtime from
// double-binding. The A2UI middleware still runs — it detects the
// `a2ui_operations` container in the tool result and streams rendered
// surfaces to the frontend.

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
    injectA2UITool: false,
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
