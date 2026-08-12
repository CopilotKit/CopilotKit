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
// Completion is OUT OF BAND by design. Mastra's `untilIdle: true` is documented
// to hold the run open and pipe the manager pubsub chunks (including
// `background-task-completed`) into the same `fullStream` so the card could flip
// to "Completed" in-turn — and the bridge DOES map every lifecycle chunk. But
// that only works when the dispatched task actually EXECUTES before the idle
// window closes, which requires a background worker/queue picking the task up.
// In this single-process Next.js demo there is no such worker: empirically the
// tool's `execute` never fires within the run, so no `background-task-completed`
// chunk is ever produced — `untilIdle` just holds the stream open for the full
// idle timeout (many wasted re-entry LLM calls, a flaky/slow card render) while
// the card stays "working" regardless. So we DON'T use it: the plain
// `getLocalAgent` path lets the run close right after `background-task-started`,
// the "working" activity card paints fast and deterministically, and completion
// is delivered out of band (a later turn / the task manager) exactly as the
// demo's tool, renderer, and e2e document. See
// `src/mastra/tools/background-research.ts` and `tests/e2e/background-agents.spec.ts`.

import { NextRequest, NextResponse } from "next/server";
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
