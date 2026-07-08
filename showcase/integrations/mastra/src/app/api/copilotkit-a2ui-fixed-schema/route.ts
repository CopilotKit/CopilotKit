// Dedicated runtime for the A2UI Fixed Schema demo (Mastra).
//
// Why its own route (and not the shared /api/copilotkit)?
// The page registers a client-side A2UI catalog (copilotkit://flight-fixed-catalog)
// and passes it via <CopilotKit a2ui={{ catalog }}>. A provider that ships a
// catalog makes the runtime default `injectA2UITool` to true (see
// packages/runtime/.../shared/agent-utils.ts). But weatherAgent already owns
// its own `generate_a2ui` tool, so we must set injectA2UITool:false to avoid a
// double-bind — the same reasoning as /api/copilotkit-beautiful-chat. We also
// pin defaultCatalogId so a model that omits catalogId still resolves the
// registered catalog instead of erroring with "Catalog not found". These A2UI
// flags are global to a CopilotRuntime; enabling them on the shared endpoint
// would leak the tool-suppression + catalog pin onto every other demo — hence a
// dedicated route, matching the pattern the north-star langgraph-python uses.
//
// NOTE (OSS-451): this route was missing entirely — the page pointed at
// /api/copilotkit-a2ui-fixed-schema, which 404'd, so the demo never mounted.
// Full behavioral parity (weatherAgent emitting the flight-card operations)
// is tracked separately under OSS-381.

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

const a2uiFixedAgent = getLocalAgent({
  mastra,
  agentId: "weatherAgent",
  resourceId: "mastra-a2ui-fixed-schema",
});

if (!a2uiFixedAgent) {
  throw new Error(
    "getLocalAgent returned null for weatherAgent — required for /demos/a2ui-fixed-schema",
  );
}

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
  agents: {
    // The page's <CopilotKit agent="a2ui-fixed-schema"> resolves here.
    "a2ui-fixed-schema": a2uiFixedAgent,
    // Internal components call useAgent() with no args (defaults to "default").
    default: a2uiFixedAgent,
  },
  a2ui: {
    // weatherAgent already has its own `generate_a2ui` tool — don't double-bind.
    injectA2UITool: false,
    // Pin the catalog the page registers so a model omitting catalogId still
    // resolves it instead of falling back to the basic spec ("Catalog not found").
    defaultCatalogId: "copilotkit://flight-fixed-catalog",
  },
});

export const POST = async (req: NextRequest) =>
  withForwardedHeaders(req, async () => {
    try {
      const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
        endpoint: "/api/copilotkit-a2ui-fixed-schema",
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
