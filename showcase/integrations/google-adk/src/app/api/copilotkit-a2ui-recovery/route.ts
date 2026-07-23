// Dedicated runtime for the A2UI Error Recovery demo (ADK-only).
// `a2ui.injectA2UITool: false` — the backend ADK agent OWNS `generate_a2ui` via
// the ag-ui-adk >= 0.7.0 middleware (`get_a2ui_tool`, see
// src/agents/recovery_agent.py), which drives the forced `render_a2ui`
// sub-agent + the toolkit validate->retry recovery loop + the
// recovery-exhausted hard-fail envelope (OSS-158). The runtime must NOT inject
// a second copy (double-bind); this `false` is load-bearing post
// CopilotKit#5611 (a provider catalog otherwise defaults injectA2UITool to true).
//
// The demo reuses the declarative-gen-ui catalog. The aimock fixtures force the
// inner render_a2ui sub-agent to emit free-form/sloppy args the middleware heals
// (heal pill) or a structurally-invalid surface on every attempt (exhaust pill);
// @ag-ui/a2ui-middleware >= 0.0.10 renders the building -> retrying (N/M) ->
// painted / failed lifecycle.

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
    const recoveryAgent = new HttpAgent({
      url: `${AGENT_URL}/a2ui_recovery`,
      headers,
    });

    const runtime = new CopilotRuntime({
      agents: { "a2ui-recovery": recoveryAgent },
      a2ui: {
        injectA2UITool: false,
        // Reuse the catalog the page registers (shared with declarative-gen-ui).
        defaultCatalogId: "declarative-gen-ui-catalog",
      },
    });

    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit-a2ui-recovery",
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
