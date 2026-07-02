// Dedicated runtime for the Background Agents showcase cell (Mastra).
//
// The `background-agents` Mastra agent wires the backgroundable
// `run_deep_research` tool. Mastra natively supports background tasks: when
// the model calls that tool it is dispatched to Mastra's BackgroundTaskManager
// (enabled on the Mastra instance in `src/mastra/index.ts`), which emits a
// `background-task-started` lifecycle chunk. MastraAgent maps that chunk to an
// AG-UI activity event, which the Copilot Runtime forwards to the client as a
// live "working" activity card (see `src/app/demos/background-agents/page.tsx`).
//
// This uses a dedicated endpoint rather than the shared `/api/copilotkit` so
// the activity-card render path stays scoped to this cell.

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

const backgroundAgentsAgent = getLocalAgent({
  mastra,
  agentId: "backgroundAgentsAgent",
  resourceId: "mastra-background-agents",
});

if (!backgroundAgentsAgent) {
  throw new Error(
    "getLocalAgent returned null for backgroundAgentsAgent — required for /demos/background-agents",
  );
}

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
  agents: {
    "background-agents": backgroundAgentsAgent,
    // Internal components call useAgent() with no args (defaults to "default").
    default: backgroundAgentsAgent,
  },
});

export const POST = async (req: NextRequest) =>
  withForwardedHeaders(req, async () => {
    try {
      const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
        endpoint: "/api/copilotkit-background-agents",
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
