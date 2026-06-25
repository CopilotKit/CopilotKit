// Dedicated runtime for the Declarative Generative UI (A2UI - Dynamic Schema)
// cell.
//
// `injectA2UITool: false` because the backend crew owns the `generate_a2ui`
// tool itself (see src/agents/declarative_gen_ui.py). The A2UI middleware
// still runs on the runtime side so the registered client catalog is
// serialised into `copilotkit.context` for the secondary LLM inside the tool.
//
// Agent URL points at the dedicated `/declarative-gen-ui` FastAPI endpoint
// mounted by `agent_server.py`, so this demo runs against its own crew
// rather than the shared `LatestAiDevelopment` crew on "/".

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

function createAgent() {
  return new HttpAgent({ url: `${AGENT_URL}/declarative-gen-ui` });
}

const agents: Record<string, AbstractAgent> = {
  "declarative-gen-ui": createAgent(),
  default: createAgent(),
};

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
  agents,
  a2ui: {
    injectA2UITool: false,
    // Models follow the tool-usage guide and omit `catalogId`, and the
    // middleware then falls back to the unregistered spec basic catalog
    // ("Catalog not found" render error). Pin the catalog the page registers.
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
