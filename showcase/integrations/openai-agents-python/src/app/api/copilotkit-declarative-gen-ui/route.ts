// Dedicated runtime for the Declarative Generative UI (A2UI — Dynamic Schema)
// cell. Unlike langgraph-python, which lets the runtime inject the A2UI tool,
// the backend agent owns `generate_a2ui` as a server tool: it makes its own
// forced `render_a2ui` model call, validates the surface (retrying on
// errors) and returns the `a2ui_operations` container, which the A2UI
// middleware detects in the tool result and paints with the page's catalog.
//
// Reference:
// - showcase/integrations/langgraph-python/src/app/api/copilotkit-declarative-gen-ui/route.ts
// - src/demo_agents/a2ui_dynamic.py (the backend agent)

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime";
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
        "declarative-gen-ui": new HttpAgent({
          url: `${AGENT_URL}/declarative_gen_ui`,
          headers,
        }),
      },
      generativeUI: {
        a2uiVersion: "0.9",
        // The backend owns `generate_a2ui` (src/demo_agents/a2ui_dynamic.py) and
        // returns an `a2ui_operations` container in its tool result; the
        // middleware still runs to paint it. `false` is load-bearing: a
        // provider catalog otherwise defaults injection on, which would hand
        // the model a second, frontend-side `render_a2ui` tool.
        injectA2UITool: false,
        // The catalog the page registers (declarative-gen-ui/a2ui/catalog.ts).
        defaultCatalogId: "declarative-gen-ui-catalog",
      },
    });

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
