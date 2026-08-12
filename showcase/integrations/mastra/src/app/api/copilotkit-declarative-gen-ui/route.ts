// Dedicated runtime for the Declarative Generative UI (A2UI Dynamic) demo (Mastra).
//
// Why its own route (and not the shared /api/copilotkit)?
// The page registers a client-side A2UI catalog ("declarative-gen-ui-catalog")
// and passes it via <CopilotKit a2ui={{ catalog: myCatalog }}>. A provider that
// ships a catalog makes the runtime default `injectA2UITool` to true (see
// packages/runtime/.../shared/agent-utils.ts). weatherAgent already owns its own
// `generate_a2ui` tool, so we set injectA2UITool:false to avoid a double-bind —
// the same reasoning as /api/copilotkit-beautiful-chat. We pin defaultCatalogId
// so a model omitting catalogId still resolves the registered catalog instead of
// erroring with "Catalog not found". These A2UI flags are global to a
// CopilotRuntime; enabling them on the shared endpoint would leak onto every
// other demo — hence a dedicated route, matching north-star langgraph-python.
//
// NOTE (OSS-451): this route was missing entirely — the page pointed at
// /api/copilotkit-declarative-gen-ui, which 404'd, so the demo never mounted.
// Full behavioral parity (weatherAgent driving the dynamic A2UI tree) is
// tracked separately under OSS-381.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { getLocalAgent } from "@ag-ui/mastra";
import { mastra } from "@/mastra";
import { withForwardedHeaders } from "@/mastra/_header_forwarding";

const declarativeGenUiAgent = getLocalAgent({
  mastra,
  agentId: "weatherAgent",
  resourceId: "mastra-declarative-gen-ui",
});

if (!declarativeGenUiAgent) {
  throw new Error(
    "getLocalAgent returned null for weatherAgent — required for /demos/declarative-gen-ui",
  );
}

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
  agents: {
    // The page's <CopilotKit agent="declarative-gen-ui"> resolves here.
    "declarative-gen-ui": declarativeGenUiAgent,
    // Internal components call useAgent() with no args (defaults to "default").
    default: declarativeGenUiAgent,
  },
  a2ui: {
    // weatherAgent already has its own `generate_a2ui` tool — don't double-bind.
    injectA2UITool: false,
    // Pin the catalog the page registers so a model omitting catalogId still
    // resolves it instead of falling back to the basic spec ("Catalog not found").
    defaultCatalogId: "declarative-gen-ui-catalog",
  },
});

export const POST = async (req: NextRequest) =>
  withForwardedHeaders(req, async () => {
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
  });
