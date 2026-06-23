// Dedicated runtime for the Declarative Generative UI (A2UI — Dynamic Schema)
// cell. The backend is the dedicated `a2ui_dynamic.py` agent mounted at
// `/declarative-gen-ui` (NOT the root catch-all `agent.py`): it owns the
// `generate_a2ui` tool explicitly and runs its own secondary `render_a2ui`
// LLM pass, returning an `a2ui_operations` container that the A2UI
// middleware detects and streams to the frontend. This mirrors the sibling
// dedicated routes (`/a2ui-fixed-schema/`, `/beautiful-chat/`, etc.) which
// all point at their named mount, and matches the D6 fixtures + PARITY_NOTES.
//
// `injectA2UITool: false` — the agent already owns `generate_a2ui`, so the
// runtime must NOT double-bind a second injected A2UI tool over it.

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
    // The dedicated agent owns `generate_a2ui` and produces the
    // `a2ui_operations` container itself; do not inject a second A2UI tool.
    injectA2UITool: false,
    // Pin the catalog the page registers (mirrors the sibling
    // `/copilotkit-beautiful-chat` and `/copilotkit-a2ui-fixed-schema`
    // routes). The agent's emitted ops already carry this catalogId, but
    // pinning it guards against any op that omits it falling back to the
    // unregistered basic catalog ("Catalog not found" → surface never mounts).
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
