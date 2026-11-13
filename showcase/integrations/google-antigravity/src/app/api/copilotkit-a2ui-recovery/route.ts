// Dedicated runtime for the A2UI Error Recovery demo.
// `a2ui.injectA2UITool: false` — the backend AntigravityAgent OWNS
// `generate_a2ui` (src/agents/a2ui_dynamic.py, wired by
// src/agents/a2ui_recovery.py), whose body runs the forced `render_a2ui`
// sub-agent call + the A2UI toolkit validate->retry recovery loop + the
// recovery-exhausted hard-fail envelope. The runtime must NOT inject a second
// copy; this `false` is load-bearing post CopilotKit#5611 (the provider catalog
// otherwise defaults injectA2UITool to true). The middleware still renders the
// painted / failed end-states from the tool result.
//
// The demo reuses the declarative-gen-ui catalog. The aimock fixtures force the
// inner render_a2ui call to emit an invalid surface once (heal pill) or on
// every attempt (exhaust pill).
//
// Reference:
// - showcase/integrations/langgraph-python/src/app/api/copilotkit-a2ui-recovery/route.ts

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { HttpAgent } from "@ag-ui/client";
import { extractForwardedHeaders } from "@/lib/header-forwarding";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

// Build per-request so inbound `x-aimock-context` (and other `x-*` headers)
// is forwarded onto the outbound call to the Python agent_server. See
// `src/lib/header-forwarding.ts` for the rationale.
export const POST = async (req: NextRequest) => {
  try {
    const headers = extractForwardedHeaders(req);

    const runtime = new CopilotRuntime({
      agents: {
        "a2ui-recovery": new HttpAgent({
          url: `${AGENT_URL}/a2ui_recovery`,
          headers,
        }),
      },
      a2ui: {
        // The backend owns `generate_a2ui` and its recovery loop; the runtime
        // must not inject a second A2UI tool (see the header comment).
        injectA2UITool: false,
        // The catalog the page registers (declarative-gen-ui/a2ui/catalog.ts).
        defaultCatalogId: "declarative-gen-ui-catalog",
      },
    });

    const copilotHandler = createCopilotRuntimeHandler({
      runtime,
      basePath: "/api/copilotkit-a2ui-recovery",
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
