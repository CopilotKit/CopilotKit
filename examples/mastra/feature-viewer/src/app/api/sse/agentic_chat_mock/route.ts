import { NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import {
  EventType,
  RunAgentInputSchema,
  TextMessageStartEvent,
  TextMessageContentEvent,
  TextMessageEndEvent,
  RunStartedEvent,
  RunFinishedEvent,
  ToolCallStartEvent,
  ToolCallEndEvent,
  ToolCallArgsEvent,
  MessagesSnapshotEvent,
  Message,
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
        const lastMessageContent =
          input.messages[input.messages.length - 1]?.content;

        const sendEvent = (event: any) => {
          controller.enqueue(eventEncoder.encode(event));
        };

        // First event must be run_started
        sendEvent({
          type: EventType.RUN_STARTED,
          threadId: input.threadId,
          runId: input.runId,
        } as RunStartedEvent);

        if (lastMessageContent === "tool") {
          await sendToolCallEvents(sendEvent, input.messages);
        } else {
          await sendTextMessageEvents(sendEvent);
        }

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

async function sendTextMessageEvents(sendEvent: (event: any) => void) {
  const messageId = uuidv4();

  // Start of message
  sendEvent({
    type: EventType.TEXT_MESSAGE_START,
    messageId,
    role: "assistant",
  } as TextMessageStartEvent);

  // Initial content chunk
  sendEvent({
    type: EventType.TEXT_MESSAGE_CONTENT,
    messageId,
    delta: "Integrating your framework in: ",
  } as TextMessageContentEvent);

  for (let count = 10; count >= 1; count--) {
    sendEvent({
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId,
      delta: `${count}  `,
    } as TextMessageContentEvent);

    await sleep(300);
  }

  // Final checkmark
  sendEvent({
    type: EventType.TEXT_MESSAGE_CONTENT,
    messageId,
    delta: "✓",
  } as TextMessageContentEvent);

  // End of message
  sendEvent({
    type: EventType.TEXT_MESSAGE_END,
    messageId,
  } as TextMessageEndEvent);

  // sending a final messages snapshot is optional, see sendToolCallEvents for an example
}

async function sendToolCallEvents(
  sendEvent: (event: any) => void,
  messages: Message[]
) {
  const toolCallId = uuidv4();
  const toolCallName = "change_background";
  const toolCallArgs = {
    background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
  };

  sendEvent({
    type: EventType.TOOL_CALL_START,
    toolCallId,
    toolCallName,
  } as ToolCallStartEvent);

  sendEvent({
    type: EventType.TOOL_CALL_ARGS,
    toolCallId,
    delta: JSON.stringify(toolCallArgs),
  } as ToolCallArgsEvent);

  sendEvent({
    type: EventType.TOOL_CALL_END,
    toolCallId,
  } as ToolCallEndEvent);

  sendEvent({
    type: EventType.MESSAGES_SNAPSHOT,
    messages: [
      ...messages,
      {
        id: uuidv4(),
        role: "assistant",
        toolCalls: [
          {
            id: toolCallId,
            type: "function",
            function: {
              name: toolCallName,
              arguments: JSON.stringify(toolCallArgs),
            },
          },
        ],
      },
    ],
  } as MessagesSnapshotEvent);
}
