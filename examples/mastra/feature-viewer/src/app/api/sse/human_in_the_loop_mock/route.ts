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
  Message,
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

        const lastMessage = input.messages[input.messages.length - 1];

        // First event must be run_started
        sendEvent({
          type: EventType.RUN_STARTED,
          threadId: input.threadId,
          runId: input.runId,
        } as RunStartedEvent);

        if (lastMessage.role === "tool") {
          await sendTextMessageEvents(sendEvent);
        } else {
          await sendToolCallEvents(sendEvent);
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

async function sendToolCallEvents(sendEvent: (event: any) => void) {
  const toolCallId = uuidv4();
  const toolCallName = "generate_task_steps";

  sendEvent({
    type: EventType.TOOL_CALL_START,
    toolCallId,
    toolCallName,
  } as ToolCallStartEvent);

  sendEvent({
    type: EventType.TOOL_CALL_ARGS,
    toolCallId,
    delta: '{"steps":[',
  } as ToolCallArgsEvent);

  for (let i = 0; i < 10; i++) {
    sendEvent({
      type: EventType.TOOL_CALL_ARGS,
      toolCallId,
      delta:
        JSON.stringify({
          description: "Step " + (i + 1),
          status: "enabled",
        }) + (i != 9 ? "," : ""),
    } as ToolCallArgsEvent);
    await sleep(200);
  }

  sendEvent({
    type: EventType.TOOL_CALL_ARGS,
    toolCallId,
    delta: "]}",
  } as ToolCallArgsEvent);

  sendEvent({
    type: EventType.TOOL_CALL_END,
    toolCallId,
  } as ToolCallEndEvent);
}

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
    delta: "Ok! I'm working on it.",
  } as TextMessageContentEvent);

  // End of message
  sendEvent({
    type: EventType.TEXT_MESSAGE_END,
    messageId,
  } as TextMessageEndEvent);
}
