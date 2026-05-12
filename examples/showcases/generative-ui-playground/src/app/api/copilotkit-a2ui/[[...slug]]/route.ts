/**
 * CopilotKit API route for A2UI agent.
 *
 * Uses @copilotkit/runtime for A2A compatibility.
 * The A2AAgent from @ag-ui/a2a works with the v2 runtime API.
 */

import {
  CopilotRuntime,
  createCopilotEndpoint,
  InMemoryAgentRunner,
} from "@copilotkit/runtime/v2";
import { handle } from "hono/vercel";
import { A2AAgent, type A2AStreamEvent } from "@ag-ui/a2a";
import { A2AClient } from "@a2a-js/sdk/client";

type A2ATaskTracker = {
  requestCancel: () => void;
  rememberTaskFromEvent: (event: A2AStreamEvent) => void;
};

function getTaskIdFromEvent(event: A2AStreamEvent): string | undefined {
  if ("taskId" in event && typeof event.taskId === "string") {
    return event.taskId;
  }

  if ("kind" in event && event.kind === "task" && "id" in event) {
    return event.id;
  }

  return undefined;
}

function shouldClearTaskFromEvent(event: A2AStreamEvent): boolean {
  return "kind" in event && event.kind === "status-update" && event.final === true;
}

function trackA2ATasks(a2aClient: A2AClient): A2ATaskTracker {
  let activeTaskId: string | undefined;
  let cancelRequested = false;
  let cancelInFlightForTaskId: string | undefined;
  const originalSendMessageStream = a2aClient.sendMessageStream.bind(a2aClient);

  const cancelActiveTask = () => {
    if (!activeTaskId || cancelInFlightForTaskId === activeTaskId) {
      console.info("[A2A stop] cancel requested before task id is known");
      return;
    }

    const taskId = activeTaskId;
    cancelInFlightForTaskId = taskId;
    console.info("[A2A stop] cancelling task", taskId);
    void a2aClient
      .cancelTask({ id: taskId })
      .catch((error) => {
        console.warn("[A2A stop] failed to cancel task", taskId, error);
      })
      .finally(() => {
        if (cancelInFlightForTaskId === taskId) {
          cancelInFlightForTaskId = undefined;
        }
      });
  };

  const tracker: A2ATaskTracker = {
    requestCancel() {
      cancelRequested = true;
      cancelActiveTask();
    },
    rememberTaskFromEvent(event) {
      const taskId = getTaskIdFromEvent(event);
      if (taskId) {
        activeTaskId = taskId;
        if (cancelRequested) {
          cancelActiveTask();
        }
      }

      if (shouldClearTaskFromEvent(event)) {
        activeTaskId = undefined;
        cancelRequested = false;
      }
    },
  };

  a2aClient.sendMessageStream = (async function* trackedSendMessageStream(
    ...args: Parameters<A2AClient["sendMessageStream"]>
  ) {
    cancelRequested = false;
    for await (const event of originalSendMessageStream(...args)) {
      tracker.rememberTaskFromEvent(event);
      yield event;
    }
  }) as A2AClient["sendMessageStream"];

  return tracker;
}

class CancellableA2AAgent extends A2AAgent {
  constructor(
    private readonly config: { a2aClient: A2AClient; taskTracker: A2ATaskTracker },
  ) {
    super(config as unknown as ConstructorParameters<typeof A2AAgent>[0]);
  }

  clone() {
    return new CancellableA2AAgent(this.config);
  }

  abortRun() {
    console.info("[A2A stop] abortRun called");
    this.config.taskTracker.requestCancel();
    super.abortRun();
  }
}

// Prefer explicit agent card URL for newer @a2a-js/sdk versions.
const a2aAgentCardUrl =
  process.env.A2A_AGENT_CARD_URL ??
  process.env.A2A_AGENT_URL ??
  "http://localhost:10002";
const a2aClient = new A2AClient(a2aAgentCardUrl);
const taskTracker = trackA2ATasks(a2aClient);

// A2AAgent handles A2UI extension negotiation with the Python server
const a2uiAgent = new CancellableA2AAgent({ a2aClient, taskTracker });

// Create CopilotKit runtime with A2UI agent as default
const runtime = new CopilotRuntime({
  agents: {
    default: a2uiAgent,
  },
  runner: new InMemoryAgentRunner(),
});

// Create Hono endpoint
const app = createCopilotEndpoint({
  runtime,
  basePath: "/api/copilotkit-a2ui",
});

export const GET = handle(app);
export const POST = handle(app);
