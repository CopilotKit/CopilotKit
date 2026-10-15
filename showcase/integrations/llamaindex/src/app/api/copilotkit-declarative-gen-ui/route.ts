// Dedicated runtime for the Declarative Generative UI (A2UI — Dynamic Schema)
// cell. Mirrors `langgraph-python/src/app/api/copilotkit-declarative-gen-ui/`.
//
// The backend agent (src/agents/a2ui_dynamic.py) owns a `generate_a2ui` tool
// and emits a streamed `render_a2ui` call. The middleware watches that call
// without injecting a second tool.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
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
    a2uiToolNames: ["render_a2ui"],
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
