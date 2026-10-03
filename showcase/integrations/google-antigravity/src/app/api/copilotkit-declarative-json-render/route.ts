// Dedicated runtime for the declarative-json-render demo.
//
// Splitting into its own endpoint (mirroring beautiful-chat +
// declarative-gen-ui) keeps the agent isolated from the default multi-agent
// `/api/copilotkit` runtime. The demo page
// (src/app/demos/declarative-json-render/page.tsx) points
// `<CopilotKit runtimeUrl>` here under the agent name `byoc_json_render`.
// The backend (src/agents/byoc_json_render.py) is a tool-less
// AntigravityAgent whose system prompt makes it reply with a
// `{ root, elements }` json-render spec as plain assistant text.
//
// Reference:
// - showcase/integrations/langgraph-python/src/app/api/copilotkit-declarative-json-render/route.ts

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
        byoc_json_render: new HttpAgent({
          url: `${AGENT_URL}/declarative_json_render`,
          headers,
        }),
      },
    });

    const copilotHandler = createCopilotRuntimeHandler({
      runtime,
      basePath: "/api/copilotkit-declarative-json-render",
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
