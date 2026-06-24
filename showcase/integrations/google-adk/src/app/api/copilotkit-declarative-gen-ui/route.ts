// Dedicated runtime for the Declarative Generative UI (A2UI — Dynamic Schema)
// demo. `a2ui.injectA2UITool: false` — the backend ADK agent OWNS
// `generate_a2ui` via the ag-ui-adk >= 0.7.0 middleware (`get_a2ui_tool`, see
// src/agents/declarative_gen_ui_agent.py), which drives the forced
// `render_a2ui` sub-agent + toolkit recovery loop + recovery-exhausted
// hard-fail envelope (OSS-158). The runtime must NOT inject a second copy or it
// would double-bind the tool slot. NOTE: this `false` is load-bearing —
// CopilotKit#5611 makes a provider catalog default `injectA2UITool` to true, so
// omitting it would re-introduce the double-bind. Mirrors the AWS Strands / ag2
// external-framework convention (vs langgraph-python's runtime-driven `true`).
//
// The A2UI middleware still serialises the registered client catalog into the
// agent's context (routed into the sub-agent prompt) so the planner knows
// which components to emit, and detects the `a2ui_operations` container in the
// tool result for client-side rendering.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { HttpAgent } from "@ag-ui/client";
import { extractForwardedHeaders } from "@/lib/header-forwarding";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

export const POST = async (req: NextRequest) => {
  try {
    // Per-request build conveys inbound `x-aimock-context` to the Python
    // agent_server. See `src/lib/header-forwarding.ts`.
    const headers = extractForwardedHeaders(req);
    const declarativeGenUiAgent = new HttpAgent({
      url: `${AGENT_URL}/declarative_gen_ui`,
      headers,
    });

    const runtime = new CopilotRuntime({
      agents: { "declarative-gen-ui": declarativeGenUiAgent },
      a2ui: {
        injectA2UITool: false,
        // Models follow the tool-usage guide and omit `catalogId`, and the
        // middleware then falls back to the unregistered spec basic catalog
        // ("Catalog not found" render error). Pin the catalog the page registers.
        defaultCatalogId: "declarative-gen-ui-catalog",
      },
    });

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
