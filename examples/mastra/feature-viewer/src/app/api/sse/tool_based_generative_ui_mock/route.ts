import { NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import {
  EventType,
  RunAgentInputSchema,
  RunStartedEvent,
  RunFinishedEvent,
  MessagesSnapshotEvent,
} from "@ag-ui/core";
import { EventEncoder } from "@ag-ui/encoder";

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

        // send a messages snapshot
        sendEvent({
          type: EventType.MESSAGES_SNAPSHOT,
          messages: [
            ...input.messages,
            {
              id: uuidv4(),
              role: "assistant",
              toolCalls: [
                {
                  id: uuidv4(),
                  type: "function",
                  function: {
                    name: "generate_haiku",
                    arguments: JSON.stringify({
                      japanese: ["エーアイの", "橋つなぐ道", "コパキット"],
                      english: [
                        "From AI's realm",
                        "A bridge-road linking us—",
                        "CopilotKit.",
                      ],
                    }),
                  },
                },
              ],
            },
          ],
        } as MessagesSnapshotEvent);

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
