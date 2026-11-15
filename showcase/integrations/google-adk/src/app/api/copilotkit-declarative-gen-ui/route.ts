// A plain ADK agent: the runtime forwards the catalog and injectA2UITool flag,
// and the adapter injects exactly one generate_a2ui tool. Provider properties
// forward a2ui.inferenceFormat to the actual SDK factory per request.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
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
