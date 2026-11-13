// Dedicated runtime for the declarative-hashbrown demo.
//
// The demo page (`src/app/demos/declarative-hashbrown/page.tsx`) wraps the
// `<Chat />` component (`./chat.tsx`) in the HashBrownDashboard provider;
// `Chat` overrides the CopilotChat assistantMessage slot with a renderer
// that consumes hashbrown-shaped structured output via `@hashbrownai/react`'s
// `useUiKit` + `useJsonParser`. The backend (src/agents/byoc_hashbrown.py)
// is a tool-less AntigravityAgent whose system prompt makes it reply with
// that JSON as plain assistant text.
//
// Reference:
// - showcase/integrations/langgraph-python/src/app/api/copilotkit-declarative-hashbrown/route.ts

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
        "declarative-hashbrown-demo": new HttpAgent({
          url: `${AGENT_URL}/declarative_hashbrown`,
          headers,
        }),
      },
    });

    const copilotHandler = createCopilotRuntimeHandler({
      runtime,
      basePath: "/api/copilotkit-declarative-hashbrown",
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
