import { NextResponse } from "next/server";
import {
  EventType,
  RunAgentInputSchema,
  RunStartedEvent,
  RunFinishedEvent,
  StateSnapshotEvent,
  StateDeltaEvent,
} from "@ag-ui/core";
import { EventEncoder } from "@ag-ui/encoder";
import * as jsonPatch from "fast-json-patch";

// Mock BaseEvent stream for demonstrative purposes
export async function POST(req: Request) {
  // Create event encoder with accept header from request
  const eventEncoder = new EventEncoder({
    accept: req.headers.get("accept") || undefined,
  });

  try {
    // Parse and validate the request body
    const body = await req.json();
    const input = RunAgentInputSchema.parse(body);

    const stream = new ReadableStream({
      async start(controller) {
        const sendEvent = (event: any) => {
          controller.enqueue(eventEncoder.encode(event));
        };

        // First event must be run_started
        sendEvent({
          type: EventType.RUN_STARTED,
          threadId: input.threadId,
          runId: input.runId,
        } as RunStartedEvent);

        await sendStateEvents(sendEvent);

        // Last event must be run_finished
        sendEvent({
          type: EventType.RUN_FINISHED,
          threadId: input.threadId,
          runId: input.runId,
        } as RunFinishedEvent);

        controller.close();
      },
    });

    return new NextResponse(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error: any) {
    console.error(error);
    throw error;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function sendStateEvents(sendEvent: (event: any) => void) {
  const state = {
    steps: Array.from({ length: 10 }, (_, i) => i).map((i) => ({
      description: `Step ${i + 1}`,
      status: "pending",
    })),
  };

  sendEvent({
    type: EventType.STATE_SNAPSHOT,
    snapshot: state,
  } as StateSnapshotEvent);
  await sleep(1000);

  // tracking the state changes allows us to send only the delta to the client
  const observer = jsonPatch.observe<typeof state>(state);

  for (const step of state.steps) {
    step.status = "completed";

    // send a JSON patch to the client
    const patch = jsonPatch.generate(observer);

    sendEvent({
      type: EventType.STATE_DELTA,
      delta: patch,
    } as StateDeltaEvent);
    await sleep(1000);
  }

  // optionally send a final snapshot to the client
  sendEvent({
    type: EventType.STATE_SNAPSHOT,
    snapshot: state,
  } as StateSnapshotEvent);
}
