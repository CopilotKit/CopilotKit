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
  CustomEvent,
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

function makeStory(name: string) {
  return `Once upon a time, there was a dog named ${name}. ${name} was a very good dog.`;
}

const dogNames = ["Rex", "Buddy", "Max", "Charlie", "Buddy", "Max", "Charlie"];

async function sendToolCallEvents(sendEvent: (event: any) => void) {
  const toolCallId = uuidv4();
  const toolCallName = "write_document";

  const story = makeStory(
    dogNames[Math.floor(Math.random() * dogNames.length)]
  );

  const storyChunks = story.split(" ");

  sendEvent({
    type: EventType.CUSTOM,
    name: "PredictState",
    value: [
      {
        state_key: "document",
        tool: "write_document",
        tool_argument: "document",
      },
    ],
  } as CustomEvent);

  sendEvent({
    type: EventType.TOOL_CALL_START,
    toolCallId,
    toolCallName,
  } as ToolCallStartEvent);

  sendEvent({
    type: EventType.TOOL_CALL_ARGS,
    toolCallId,
    delta: '{"document":"',
  } as ToolCallArgsEvent);

  for (let i = 0; i < storyChunks.length; i++) {
    sendEvent({
      type: EventType.TOOL_CALL_ARGS,
      toolCallId,
      delta: storyChunks[i] + " ",
    } as ToolCallArgsEvent);
    await sleep(200);
  }

  sendEvent({
    type: EventType.TOOL_CALL_ARGS,
    toolCallId,
    delta: '"}',
  } as ToolCallArgsEvent);

  sendEvent({
    type: EventType.TOOL_CALL_END,
    toolCallId,
  } as ToolCallEndEvent);

  const toolCallId2 = uuidv4();
  const toolCallName2 = "confirm_changes";

  sendEvent({
    type: EventType.TOOL_CALL_START,
    toolCallId: toolCallId2,
    toolCallName: toolCallName2,
  } as ToolCallStartEvent);

  sendEvent({
    type: EventType.TOOL_CALL_ARGS,
    toolCallId: toolCallId2,
    delta: "{}",
  } as ToolCallArgsEvent);

  sendEvent({
    type: EventType.TOOL_CALL_END,
    toolCallId: toolCallId2,
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
    delta: "Ok!",
  } as TextMessageContentEvent);

  // End of message
  sendEvent({
    type: EventType.TEXT_MESSAGE_END,
    messageId,
  } as TextMessageEndEvent);
}
