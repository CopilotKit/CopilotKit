import { EventType } from "@ag-ui/client";
import type {
  AgentSubscriber,
  BaseEvent,
  RunErrorEvent,
  RunFinishedEvent,
  RunAgentInput,
  RunStartedEvent,
  TextMessageContentEvent,
  ToolCallEndEvent,
} from "@ag-ui/client";
import { expect, test } from "vitest";
import { z } from "zod";
import type { CapturedToolCall, RunRenderer } from "./platform-adapter.js";
import { runAgentLoop } from "./run-loop.js";
import { FakeAgent } from "./testing/fake-agent.js";
import type { ChannelTool } from "./tools.js";

const canonicalRun = {
  threadId: "canonical-thread",
  runId: "canonical-run",
};

type TestEvent =
  | RunStartedEvent
  | RunFinishedEvent
  | RunErrorEvent
  | TextMessageContentEvent
  | ToolCallEndEvent;

function lifecycleBatch(
  runId: string,
  middle: readonly TestEvent[],
): TestEvent[] {
  return [
    {
      type: EventType.RUN_STARTED,
      threadId: "inner-thread",
      runId,
    },
    ...middle,
    {
      type: EventType.RUN_FINISHED,
      threadId: "inner-thread",
      runId,
    },
  ];
}

function textEvent(messageId: string, text: string): TextMessageContentEvent {
  return {
    type: EventType.TEXT_MESSAGE_CONTENT,
    messageId,
    delta: text,
  };
}

async function emitBatch(
  subscriber: AgentSubscriber,
  agent: FakeAgent,
  runId: string,
  middle: readonly TestEvent[],
): Promise<void> {
  const input: RunAgentInput = {
    threadId: agent.threadId,
    runId,
    messages: agent.messages,
    state: agent.state,
    tools: [],
    context: [],
    forwardedProps: {},
  };
  const params = {
    messages: agent.messages,
    state: agent.state,
    agent,
    input,
  };

  for (const event of lifecycleBatch(runId, middle)) {
    await subscriber.onEvent?.({ ...params, event });
    switch (event.type) {
      case EventType.RUN_STARTED:
        await subscriber.onRunStartedEvent?.({ ...params, event });
        break;
      case EventType.RUN_FINISHED:
        await subscriber.onRunFinishedEvent?.({
          ...params,
          event,
          outcome: "success",
        });
        break;
      case EventType.RUN_ERROR:
        await subscriber.onRunErrorEvent?.({ ...params, event });
        break;
      case EventType.TEXT_MESSAGE_CONTENT:
        await subscriber.onTextMessageContentEvent?.({
          ...params,
          event,
          textMessageBuffer: event.delta,
        });
        break;
      case EventType.TOOL_CALL_END:
        await subscriber.onToolCallEndEvent?.({
          ...params,
          event,
          toolCallName: "echo",
          toolCallArgs: { value: "ok" },
        });
        break;
    }
  }
}

function setupRenderer(
  options: { failOnContent?: boolean; failOnFinish?: boolean } = {},
): {
  renderer: RunRenderer;
  renderedEvents: BaseEvent[];
} {
  const renderedEvents: BaseEvent[] = [];
  const toolCalls: CapturedToolCall[] = [];
  const subscriber: AgentSubscriber = {
    onRunStartedEvent: ({ event }) => {
      renderedEvents.push(event);
    },
    onRunFinishedEvent: ({ event }) => {
      renderedEvents.push(event);
      if (options.failOnFinish) {
        throw new Error("renderer finalization failed");
      }
    },
    onRunErrorEvent: ({ event }) => {
      renderedEvents.push(event);
    },
    onTextMessageContentEvent: ({ event }) => {
      renderedEvents.push(event);
      if (options.failOnContent) {
        throw new Error("renderer failed");
      }
    },
    onToolCallEndEvent: ({ event, toolCallName, toolCallArgs }) => {
      toolCalls.push({
        toolCallId: event.toolCallId,
        toolCallName,
        toolCallArgs,
      });
    },
  };
  return {
    renderer: {
      subscriber,
      markInterrupted: async () => {},
      getCapturedToolCalls: () => toolCalls,
      getPendingInterrupt: () => undefined,
      clearPendingInterrupt: () => {},
    },
    renderedEvents,
  };
}

test("managed runAgentLoop emits one canonical lifecycle and shares stamped events with ingestion and rendering", async () => {
  let agent!: FakeAgent;
  agent = new FakeAgent([
    (subscriber) =>
      emitBatch(subscriber, agent, "inner-run-1", [
        textEvent("message-1", "first"),
        {
          type: EventType.TOOL_CALL_END,
          toolCallId: "tool-call-1",
        },
      ]),
    (subscriber) =>
      emitBatch(subscriber, agent, "inner-run-2", [
        textEvent("message-2", "second"),
      ]),
  ]);
  const { renderer, renderedEvents } = setupRenderer();
  const ingestedEvents: BaseEvent[] = [];
  const echo: ChannelTool = {
    name: "echo",
    description: "Return the value.",
    parameters: z.object({ value: z.string() }),
    handler: ({ value }) => value,
  };

  const result = await runAgentLoop({
    agent,
    renderer,
    tools: new Map([["echo", echo]]),
    toolDescriptors: [],
    context: [],
    makeToolCtx: () => {
      throw new Error("tool context is not used by this test");
    },
    subscriber: {
      onEvent: ({ event }) => {
        ingestedEvents.push(event);
      },
    },
    canonicalRun,
  });

  const lifecycleTypes = ingestedEvents
    .filter(
      ({ type }) =>
        type === EventType.RUN_STARTED ||
        type === EventType.RUN_FINISHED ||
        type === EventType.RUN_ERROR,
    )
    .map(({ type }) => type);
  const ingestedContent = ingestedEvents.filter(
    ({ type }) => type === EventType.TEXT_MESSAGE_CONTENT,
  );
  const renderedContent = renderedEvents.filter(
    ({ type }) => type === EventType.TEXT_MESSAGE_CONTENT,
  );

  expect(result).toEqual({ iterations: 2, interrupted: false });
  expect(lifecycleTypes).toEqual([
    EventType.RUN_STARTED,
    EventType.RUN_FINISHED,
  ]);
  expect(
    renderedEvents
      .filter(
        ({ type }) =>
          type === EventType.RUN_STARTED ||
          type === EventType.RUN_FINISHED ||
          type === EventType.RUN_ERROR,
      )
      .map(({ type }) => type),
  ).toEqual([EventType.RUN_STARTED, EventType.RUN_FINISHED]);
  expect(ingestedContent).toHaveLength(2);
  expect(renderedContent).toHaveLength(2);
  expect(renderedContent[0]).toBe(ingestedContent[0]);
  expect(renderedContent[1]).toBe(ingestedContent[1]);
  expect(ingestedEvents).toEqual(
    expect.arrayContaining([
      expect.objectContaining(canonicalRun),
      expect.objectContaining({
        ...canonicalRun,
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: "message-1",
      }),
      expect.objectContaining({
        ...canonicalRun,
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: "message-2",
      }),
    ]),
  );
});

test("renderer failure does not stop the same canonical event from reaching ingestion", async () => {
  let agent!: FakeAgent;
  agent = new FakeAgent([
    (subscriber) =>
      emitBatch(subscriber, agent, "inner-run", [
        textEvent("message-1", "hello"),
      ]),
  ]);
  const { renderer } = setupRenderer({ failOnContent: true });
  const ingestedByTypedCallback: BaseEvent[] = [];

  await expect(
    runAgentLoop({
      agent,
      renderer,
      tools: new Map(),
      toolDescriptors: [],
      context: [],
      makeToolCtx: () => {
        throw new Error("no tool calls are expected");
      },
      subscriber: {
        onTextMessageContentEvent: ({ event }) => {
          ingestedByTypedCallback.push(event);
        },
      },
      canonicalRun,
    }),
  ).rejects.toThrow("renderer failed");

  expect(ingestedByTypedCallback).toEqual([
    expect.objectContaining({
      ...canonicalRun,
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId: "message-1",
    }),
  ]);
});

test("inner RUN_ERROR becomes one canonical outer RUN_ERROR", async () => {
  let agent!: FakeAgent;
  agent = new FakeAgent([
    (subscriber) =>
      emitBatch(subscriber, agent, "inner-run", [
        {
          type: EventType.RUN_ERROR,
          message: "inner agent failed",
          code: "INNER_FAILED",
        },
      ]),
  ]);
  const { renderer, renderedEvents } = setupRenderer();
  const ingestedEvents: BaseEvent[] = [];

  await expect(
    runAgentLoop({
      agent,
      renderer,
      tools: new Map(),
      toolDescriptors: [],
      context: [],
      makeToolCtx: () => {
        throw new Error("no tool calls are expected");
      },
      subscriber: {
        onEvent: ({ event }) => {
          ingestedEvents.push(event);
        },
      },
      canonicalRun,
    }),
  ).rejects.toMatchObject({
    message: "inner agent failed",
    code: "INNER_FAILED",
  });

  const expectedLifecycle = [
    expect.objectContaining({
      ...canonicalRun,
      type: EventType.RUN_STARTED,
    }),
    expect.objectContaining({
      ...canonicalRun,
      type: EventType.RUN_ERROR,
      message: "inner agent failed",
      code: "INNER_FAILED",
    }),
  ];
  expect(
    ingestedEvents.filter(
      ({ type }) =>
        type === EventType.RUN_STARTED ||
        type === EventType.RUN_FINISHED ||
        type === EventType.RUN_ERROR,
    ),
  ).toEqual(expectedLifecycle);
  expect(
    renderedEvents.filter(
      ({ type }) =>
        type === EventType.RUN_STARTED ||
        type === EventType.RUN_FINISHED ||
        type === EventType.RUN_ERROR,
    ),
  ).toEqual(expectedLifecycle);
});

test("renderer finalization failure replaces RUN_FINISHED with one canonical RUN_ERROR", async () => {
  let agent!: FakeAgent;
  agent = new FakeAgent([
    (subscriber) => emitBatch(subscriber, agent, "inner-run", []),
  ]);
  const { renderer } = setupRenderer({ failOnFinish: true });
  const ingestedEvents: BaseEvent[] = [];

  await expect(
    runAgentLoop({
      agent,
      renderer,
      tools: new Map(),
      toolDescriptors: [],
      context: [],
      makeToolCtx: () => {
        throw new Error("no tool calls are expected");
      },
      subscriber: {
        onEvent: ({ event }) => {
          ingestedEvents.push(event);
        },
      },
      canonicalRun,
    }),
  ).rejects.toThrow("renderer finalization failed");

  expect(
    ingestedEvents
      .filter(
        ({ type }) =>
          type === EventType.RUN_STARTED ||
          type === EventType.RUN_FINISHED ||
          type === EventType.RUN_ERROR,
      )
      .map(({ type }) => type),
  ).toEqual([EventType.RUN_STARTED, EventType.RUN_ERROR]);
});
