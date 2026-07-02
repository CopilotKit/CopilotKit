// CopilotKit runtime for the Background Agents cell (Mastra, OSS-426).
//
// The `background-agents` Mastra agent wires the backgroundable
// `run_deep_research` tool. Mastra natively supports background tasks: when the
// model calls that tool it is dispatched to Mastra's BackgroundTaskManager
// (enabled on the Mastra instance in `src/mastra/index.ts` via
// `backgroundTasks: { enabled: true }`), which emits the background-task
// lifecycle chunks. MastraAgent maps those to AG-UI activity events → a live
// activity card in the chat.
//
// `untilIdle: true` is the key: per Mastra's background-tasks docs, it keeps the
// run open and pipes the manager pubsub chunks — including
// `background-task-completed` (whose `payload.result` is the eventual tool
// result) — into the SAME run `fullStream`. Without it, the run closes after
// `background-task-started` and completion is out of band (the card would stay
// "working"). With it, the bridge forwards the full running→completed lifecycle
// so the activity card animates to done in-turn. The toggle lives on
// `getLocalAgents` (PLURAL) — `getLocalAgent` (singular) does not expose it — so
// we build the agent set with `untilIdle: true` and pick our agent out.

import { NextRequest, NextResponse } from "next/server";
import {
  CopilotRuntime,
  ExperimentalEmptyAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
} from "@copilotkit/runtime";
import { getLocalAgents } from "@ag-ui/mastra";
import { mastra } from "@/mastra";
import { withForwardedHeaders } from "@/mastra/_header_forwarding";

const localAgents = getLocalAgents({
  mastra,
  resourceId: "mastra-background-agents",
  // Pipe the background-task lifecycle (started → running → completed + result)
  // into the run's fullStream so the activity card can complete in-turn.
  untilIdle: true,
});

const backgroundAgentsAgent = localAgents["backgroundAgentsAgent"];
if (!backgroundAgentsAgent) {
  throw new Error(
    "getLocalAgents did not return backgroundAgentsAgent — required for /demos/background-agents",
  );
}

const runtime = new CopilotRuntime({
  // @ts-ignore -- see main route.ts
  agents: {
    "background-agents": backgroundAgentsAgent,
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
