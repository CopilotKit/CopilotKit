import { NextResponse } from "next/server";
import {
  EventType,
  RunAgentInputSchema,
  RunStartedEvent,
  RunFinishedEvent,
  StateSnapshotEvent,
} from "@agentwire/core";
import { EventEncoder } from "@agentwire/encoder";

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
    recipe: {
      skill_level: "Advanced",
      special_preferences: ["Low Carb", "Spicy"],
      cooking_time: "15 min",
      ingredients: "1 chicken breast, 1 tsp chili powder, Salt, Lettuce leaves",
      instructions:
        "1.	Season chicken with chili powder and salt. 2.	Sear until fully cooked. 3.	Slice and wrap in lettuce.",
    },
  };

  sendEvent({
    type: EventType.STATE_SNAPSHOT,
    snapshot: state,
  } as StateSnapshotEvent);
}
