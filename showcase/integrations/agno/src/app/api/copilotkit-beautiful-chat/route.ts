// Dedicated runtime for the Beautiful Chat flagship showcase cell (Agno).
//
// Beautiful Chat exercises A2UI (dynamic + fixed schema) and Open
// Generative UI. The canonical langgraph-python reference ships MCP Apps
// on the same runtime as well; the Agno port routes the cell at the shared
// `main` Agno agent (`/agui`) since there is no dedicated beautiful-chat
// backend endpoint — the flagship behavior comes from the runtime flags
// below plus the frontend's per-cell registrations.
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
  "beautiful-chat": new HttpAgent({ url: `${AGENT_URL}/agui` }),
  default: new HttpAgent({ url: `${AGENT_URL}/agui` }),
};

const runtime = new CopilotRuntime({
  // @ts-expect-error -- see main route.ts
  agents,
  openGenerativeUI: true,
  a2ui: {
    // The targeted `main` Agno agent (`/agui`) already registers the
    // `generate_a2ui` tool itself (src/agents/main.py), so the runtime must
    // NOT inject a second copy — that would double-bind the render tool.
    // Matches pydantic-ai's beautiful-chat (this file's mirror source) and
    // the other Agno a2ui routes, all of which set this false.
    injectA2UITool: false,
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
