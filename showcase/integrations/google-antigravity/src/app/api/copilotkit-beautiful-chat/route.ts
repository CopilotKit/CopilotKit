// Dedicated runtime for the Beautiful Chat flagship showcase cell.
//
// Beautiful Chat simultaneously exercises A2UI (dynamic + fixed schema),
// Open Generative UI, and MCP Apps. The canonical reference
// (examples/integrations/langgraph-python) ships all three flags on a single
// runtime; this route mirrors that combined-runtime shape for this
// integration so non-flagship cells keep their per-demo `useFrontendTool` /
// `useComponent` registrations isolated on the main `/api/copilotkit`
// endpoint.
//
// References:
// - showcase/integrations/langgraph-python/src/app/api/copilotkit-beautiful-chat/route.ts
// - src/app/api/copilotkit-mcp-apps/route.ts (mcpApps config pattern, this package)

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  CopilotRuntime,
  createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import type { AbstractAgent } from "@ag-ui/client";
import { HttpAgent } from "@ag-ui/client";
import { extractForwardedHeaders } from "@/lib/header-forwarding";

const AGENT_URL = process.env.AGENT_URL || "http://localhost:8000";

export const POST = async (req: NextRequest) => {
  try {
    // Per-request build so inbound `x-aimock-context` reaches the Python
    // agent_server. See `src/lib/header-forwarding.ts`.
    const headers = extractForwardedHeaders(req);
    const beautifulChatAgent: AbstractAgent = new HttpAgent({
      url: `${AGENT_URL}/beautiful_chat`,
      headers,
    });

    const agents: Record<string, AbstractAgent> = {
      // The page's <CopilotKit agent="beautiful-chat"> resolves here.
      "beautiful-chat": beautifulChatAgent,
      // Internal components (headless-chat, example-canvas) call `useAgent()`
      // with no args, which defaults to agentId "default". Alias to the same
      // agent so those component hooks resolve instead of throwing
      // "Agent 'default' not found". This matches the canonical's
      // `agents: { default: defaultAgent }` shape.
      default: beautifulChatAgent,
    };

    const runtime = new CopilotRuntime({
      agents,
      // Canonical: openGenerativeUI: true, a2ui.injectA2UITool: false, mcpApps.
      openGenerativeUI: true,
      a2ui: {
        // Mirrors the canonical route's config. `injectA2UITool: false` is
        // load-bearing post-CopilotKit#5611, which otherwise defaults
        // injectA2UITool to true when a provider catalog is present — this
        // integration's adapter does not own a `generate_a2ui` tool the way
        // the canonical backend does, so a second, runtime-injected copy
        // would be the only one in play; see PARITY_NOTES.md for the current
        // A2UI support status on this adapter.
        injectA2UITool: false,
        // Models follow the tool-usage guide and omit `catalogId`, and the
        // middleware then falls back to the unregistered spec basic catalog
        // ("Catalog not found" render error). Pin the catalog the page registers.
        defaultCatalogId: "copilotkit://app-dashboard-catalog",
      },
      mcpApps: {
        servers: [
          {
            type: "http",
            url: process.env.MCP_SERVER_URL || "https://mcp.excalidraw.com",
            // Stable serverId so persisted threads keep restoring the same MCP
            // server across URL changes.
            serverId: "beautiful_chat_mcp",
          },
        ],
      },
    });

    const copilotHandler = createCopilotRuntimeHandler({
      runtime,
      basePath: "/api/copilotkit-beautiful-chat",
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
