// Dedicated runtime for the Beautiful Chat flagship showcase cell (LlamaIndex).
//
// Beautiful Chat exercises A2UI (dynamic + fixed schema) and Open
// Generative UI. The LlamaIndex backend mounts a dedicated beautiful-chat
// workflow router at `/beautiful-chat` (see src/agent_server.py:
// `app.include_router(beautiful_chat_router, prefix="/beautiful-chat")`),
// so the cell routes there; the flagship behavior comes from that backend
// plus the runtime flags below.
//
// Isolated on its own endpoint (mirroring beautiful-chat in the canonical)
// because the `openGenerativeUI` / `a2ui` runtime flags set global state on
// the probe response that would otherwise leak into the other cells sharing
// the default `/api/copilotkit` runtime.
//
// Mirrors showcase/integrations/pydantic-ai/src/app/api/copilotkit-beautiful-chat/route.ts.

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

// The beautiful-chat page resolves <CopilotKit agent="beautiful-chat">
// here; internal components (headless-chat, example-canvas) also call
// `useAgent()` with no args, which defaults to agentId "default". Alias
// default to the same backend so those hooks resolve.
const agents: Record<string, AbstractAgent> = {
  "beautiful-chat": new HttpAgent({ url: `${AGENT_URL}/beautiful-chat/run` }),
  default: new HttpAgent({ url: `${AGENT_URL}/beautiful-chat/run` }),
};

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
  agents,
  openGenerativeUI: true,
  a2ui: {
    // Unlike the other backends' beautiful-chat routes (and pydantic-ai's
    // mirror source, which set this false), LlamaIndex's dedicated
    // beautiful-chat workflow (src/agents/beautiful_chat_agent.py) does NOT
    // register `generate_a2ui` itself — it only owns get_weather. The
    // runtime must therefore inject the dynamic render tool here.
    injectA2UITool: true,
    // Models follow the tool-usage guide and omit `catalogId`, and the
    // middleware then falls back to the unregistered spec basic catalog
    // ("Catalog not found" render error). Pin the catalog the page registers.
    defaultCatalogId: "copilotkit://app-dashboard-catalog",
  },
});

export const POST = async (req: NextRequest) => {
  try {
    const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
      endpoint: "/api/copilotkit-beautiful-chat",
      serviceAdapter: new ExperimentalEmptyAdapter(),
      runtime,
    });
    return await handleRequest(req);
  } catch (error: unknown) {
    const e = error as { message?: string; stack?: string };
    console.error(
      `[copilotkit-beautiful-chat/route] ERROR: ${e.message}`,
      e.stack,
    );
    return NextResponse.json(
      { error: "Internal Server Error" },
      { status: 500 },
    );
  }
};
