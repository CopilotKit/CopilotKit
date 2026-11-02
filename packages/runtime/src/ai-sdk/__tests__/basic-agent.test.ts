/**
 * `aiSdkAgent` run behavior, ported from the classic BuiltInAgent
 * `basic-agent.test.ts`. The real `streamText` runs over a mock model.
 *
 * Stream-part conversion cases that the real `streamText` cannot produce (an
 * unknown part type, a stream with no finish part) or that only re-test the
 * converter matrix live in `agent/__tests__/converter-aisdk.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { EventType } from "@ag-ui/client";
import type { BaseEvent, Message, RunAgentInput } from "@ag-ui/client";
import { MockLanguageModelV3 } from "ai/test";
import { z } from "zod";
import { defineTool } from "../../agent";
import type { BuiltInAgent } from "../../agent";
import {
  collectEventsIncludingErrors,
  createDefaultInput,
  eventField,
} from "../../agent/__tests__/agent-test-helpers";
import { aiSdkAgent } from "../agent";
import type { AiSdkAgentConfig } from "../agent";
import {
  eventsOfType,
  finishPart,
  modelEmitting,
  modelEmittingTurns,
  offeredToolNames,
  reasoningParts,
  runAgent,
  textParts,
  textTurn,
  toolCallPart,
} from "./mock-model";
import type { StreamPart } from "./mock-model";

const testTool = defineTool({
  name: "testTool",
  description: "A test tool.",
  parameters: z.object({ arg: z.string() }),
  execute: async () => ({ result: "success" }),
});

/** Each message the model received on its first call, as role and text. */
function promptOf(model: MockLanguageModelV3) {
  return model.doStreamCalls[0].prompt.map((message) => {
    if (typeof message.content === "string") {
      return { role: message.role, content: message.content };
    }
    const parts: ReadonlyArray<{ type: string; text?: string }> =
      message.content;
    const text = parts.map((part) => part.text ?? "").join("");
    return { role: message.role, content: text };
  });
}

function typesOf(events: BaseEvent[]) {
  return events.map((event) => event.type);
}

const reasoningLifecycle = [
  EventType.REASONING_START,
  EventType.REASONING_MESSAGE_START,
  EventType.REASONING_MESSAGE_CONTENT,
  EventType.REASONING_MESSAGE_END,
  EventType.REASONING_END,
];

/** The reasoning event types, in order, without the other events. */
function reasoningTypes(events: BaseEvent[]) {
  return typesOf(events).filter((type) => reasoningLifecycle.includes(type));
}

/** Runs a model that streams `parts` and then a finish part. */
async function runParts(
  parts: StreamPart[],
  config: Partial<AiSdkAgentConfig> = {},
) {
  const model = modelEmitting([...parts, finishPart("stop")]);
  return runAgent(aiSdkAgent({ model, ...config }));
}

/**
 * A model that streams `parts` and then keeps the stream open until the run
 * is aborted.
 */
function modelStreamingUntilAborted(parts: StreamPart[]) {
  return new MockLanguageModelV3({
    doStream: async ({ abortSignal }) => ({
      stream: new ReadableStream<StreamPart>({
        start(controller) {
          for (const part of parts) controller.enqueue(part);
          abortSignal?.addEventListener("abort", () =>
            controller.error(abortSignal.reason),
          );
        },
      }),
    }),
  });
}

/** A model stream that sends `parts`, then fails with `error`. */
function streamThenThrow(parts: StreamPart[], error: Error) {
  const pending = [...parts];
  return new ReadableStream<StreamPart>({
    pull(controller) {
      const part = pending.shift();
      if (part) controller.enqueue(part);
      else controller.error(error);
    },
  });
}

/** Runs the agent and calls `abortRun()` once `abortOn` is emitted. */
function runAndAbortOn(
  agent: BuiltInAgent,
  abortOn: EventType,
  input: Partial<RunAgentInput> = {},
) {
  return new Promise<BaseEvent[]>((resolve, reject) => {
    const events: BaseEvent[] = [];
    agent
      .run(
        createDefaultInput({
          messages: [{ id: "u1", role: "user", content: "hi" }],
          ...input,
        }),
      )
      .subscribe({
        next: (event) => {
          events.push(event);
          if (event.type === abortOn) agent.abortRun();
        },
        error: reject,
        complete: () => resolve(events),
      });
  });
}

describe("aiSdkAgent event emission", () => {
  it("wraps streamed text in RUN_STARTED and RUN_FINISHED, one chunk per delta", async () => {
    const model = modelEmitting([
      { type: "text-start", id: "msg_abc123" },
      { type: "text-delta", id: "msg_abc123", delta: "Hello" },
      { type: "text-delta", id: "msg_abc123", delta: " world" },
      { type: "text-end", id: "msg_abc123" },
      finishPart("stop"),
    ]);

    const events = await runAgent(aiSdkAgent({ model }), {
      threadId: "thread1",
      runId: "run1",
    });

    expect(events[0]).toMatchObject({
      type: EventType.RUN_STARTED,
      threadId: "thread1",
      runId: "run1",
      protocolVersion: "1.0",
    });
    expect(events.at(-1)).toMatchObject({
      type: EventType.RUN_FINISHED,
      threadId: "thread1",
      runId: "run1",
    });
    expect(eventsOfType(events, EventType.TEXT_MESSAGE_CHUNK)).toEqual([
      expect.objectContaining({
        role: "assistant",
        messageId: "msg_abc123",
        delta: "Hello",
      }),
      expect.objectContaining({ messageId: "msg_abc123", delta: " world" }),
    ]);
  });

  it("emits the tool call lifecycle and the server tool's result", async () => {
    const model = modelEmittingTurns([
      [
        { type: "tool-input-start", id: "call1", toolName: "testTool" },
        { type: "tool-input-delta", id: "call1", delta: '{"arg' },
        { type: "tool-input-delta", id: "call1", delta: '":"val"}' },
        { type: "tool-input-end", id: "call1" },
        toolCallPart("call1", "testTool", { arg: "val" }),
        finishPart("tool-calls"),
      ],
    ]);

    const events = await runAgent(aiSdkAgent({ model, tools: [testTool] }));

    const toolEvents = events.filter((event) =>
      String(event.type).startsWith("TOOL_CALL_"),
    );
    expect(toolEvents).toEqual([
      expect.objectContaining({
        type: EventType.TOOL_CALL_START,
        toolCallId: "call1",
        toolCallName: "testTool",
      }),
      expect.objectContaining({
        type: EventType.TOOL_CALL_ARGS,
        delta: '{"arg',
      }),
      expect.objectContaining({
        type: EventType.TOOL_CALL_ARGS,
        delta: '":"val"}',
      }),
      expect.objectContaining({
        type: EventType.TOOL_CALL_END,
        toolCallId: "call1",
      }),
      expect.objectContaining({
        type: EventType.TOOL_CALL_RESULT,
        role: "tool",
        toolCallId: "call1",
        content: '{"result":"success"}',
      }),
    ]);
  });

  it("emits RUN_ERROR and errors the run when the model call fails", async () => {
    const model = new MockLanguageModelV3({
      doStream: async () => {
        throw new Error("Test error");
      },
    });
    const agent = aiSdkAgent({ model });

    const { events, errored } = await collectEventsIncludingErrors(
      agent.run(
        createDefaultInput({
          messages: [{ id: "u1", role: "user", content: "hi" }],
        }),
      ),
    );

    expect(errored).toBe(true);
    const runError = eventsOfType(events, EventType.RUN_ERROR)[0];
    expect(eventField(runError, "message")).toContain("Test error");
  });
});

describe("aiSdkAgent prompt", () => {
  it("sends only the conversation when there is no prompt, context, or state", async () => {
    const model = modelEmitting(textTurn("ok"));

    await runAgent(aiSdkAgent({ model }), {
      messages: [{ id: "1", role: "user", content: "Hello" }],
    });

    expect(promptOf(model)).toEqual([{ role: "user", content: "Hello" }]);
  });

  it("sends the prompt, then context, then state as one system message before the conversation", async () => {
    const model = modelEmitting(textTurn("ok"));

    await runAgent(aiSdkAgent({ model, prompt: "You are helpful." }), {
      messages: [{ id: "1", role: "user", content: "Hello" }],
      context: [
        { description: "User Name", value: "John Doe" },
        { description: "Location", value: "New York" },
      ],
      state: { counter: 0, items: ["a", "b"] },
    });

    const prompt = promptOf(model);
    expect(prompt.map((message) => message.role)).toEqual(["system", "user"]);
    const system = prompt[0].content;
    for (const expected of [
      "You are helpful.",
      "Context from the application",
      "User Name",
      "John Doe",
      "New York",
      "Application State",
      "AGUISendStateSnapshot",
      "AGUISendStateDelta",
      '"counter": 0',
      '"items"',
    ]) {
      expect(system).toContain(expected);
    }
    const promptIndex = system.indexOf("You are helpful.");
    const contextIndex = system.indexOf("Context from the application");
    const stateIndex = system.indexOf("Application State");
    expect(promptIndex).toBeLessThan(contextIndex);
    expect(contextIndex).toBeLessThan(stateIndex);
  });
});

describe("aiSdkAgent forwarding of client system and developer messages", () => {
  const systemMessage: Message = {
    id: "sys1",
    role: "system",
    content: "System instruction",
  };
  const developerMessage: Message = {
    id: "dev1",
    role: "developer",
    content: "Developer hint",
  };
  const userMessage: Message = { id: "user1", role: "user", content: "Hello" };
  const forwardedSystem = { role: "system", content: "System instruction" };
  const forwardedDeveloper = { role: "system", content: "Developer hint" };
  const user = { role: "user", content: "Hello" };

  it.each([
    {
      name: "drops system messages by default",
      config: {},
      messages: [systemMessage, userMessage],
      expected: [user],
    },
    {
      name: "drops developer messages by default",
      config: {},
      messages: [developerMessage, userMessage],
      expected: [user],
    },
    {
      name: "forwards system messages with forwardSystemMessages",
      config: { forwardSystemMessages: true },
      messages: [systemMessage, userMessage],
      expected: [forwardedSystem, user],
    },
    {
      name: "forwards developer messages as system messages with forwardDeveloperMessages",
      config: { forwardDeveloperMessages: true },
      messages: [developerMessage, userMessage],
      expected: [forwardedDeveloper, user],
    },
    {
      name: "forwards both with both flags",
      config: { forwardSystemMessages: true, forwardDeveloperMessages: true },
      messages: [systemMessage, developerMessage, userMessage],
      expected: [forwardedSystem, forwardedDeveloper, user],
    },
    {
      name: "puts the configured prompt before forwarded messages",
      config: {
        prompt: "You are a helpful assistant.",
        forwardSystemMessages: true,
        forwardDeveloperMessages: true,
      },
      messages: [systemMessage, developerMessage, userMessage],
      expected: [
        { role: "system", content: "You are a helpful assistant." },
        forwardedSystem,
        forwardedDeveloper,
        user,
      ],
    },
  ])("$name", async ({ config, messages, expected }) => {
    const model = modelEmitting(textTurn("ok"));

    await runAgent(aiSdkAgent({ model, ...config }), { messages });

    expect(promptOf(model)).toEqual(expected);
  });
});

describe("aiSdkAgent tools offered to the model", () => {
  it("offers frontend tools, the state tools, then config tools", async () => {
    // New design: the merge order is frontend, state, MCP, learned skills,
    // then the agent's own tools (classic put config tools first).
    const configTool = defineTool({
      name: "configTool",
      description: "From config",
      parameters: z.object({}),
      execute: async () => ({ result: "ok" }),
    });
    const model = modelEmitting(textTurn("ok"));

    await runAgent(aiSdkAgent({ model, tools: [configTool] }), {
      tools: [
        {
          name: "inputTool",
          description: "From input",
          parameters: { type: "object", properties: {} },
        },
      ],
    });

    expect(offeredToolNames(model)).toEqual([
      "inputTool",
      "AGUISendStateSnapshot",
      "AGUISendStateDelta",
      "configTool",
    ]);
  });
});

describe("aiSdkAgent providerOptions", () => {
  const configured = { openai: { reasoningEffort: "low" } };
  const forwarded = { openai: { reasoningEffort: "high" } };

  it.each([
    {
      name: "passes the configured providerOptions to the model",
      overridableProperties: undefined,
      forwardedProps: {},
      expected: configured,
    },
    {
      name: "uses forwarded providerOptions when they are overridable",
      overridableProperties: ["providerOptions"],
      forwardedProps: { providerOptions: forwarded },
      expected: forwarded,
    },
    {
      name: "ignores forwarded providerOptions when they are not overridable",
      overridableProperties: [],
      forwardedProps: { providerOptions: forwarded },
      expected: configured,
    },
  ] satisfies Array<{
    name: string;
    overridableProperties: AiSdkAgentConfig["overridableProperties"];
    forwardedProps: Record<string, unknown>;
    expected: typeof configured;
  }>)("$name", async ({ overridableProperties, forwardedProps, expected }) => {
    const model = modelEmitting(textTurn("ok"));
    const agent = aiSdkAgent({
      model,
      providerOptions: configured,
      overridableProperties,
    });

    await runAgent(agent, { forwardedProps });

    expect(model.doStreamCalls[0].providerOptions).toEqual(expected);
  });
});

describe("aiSdkAgent reasoning", () => {
  it("emits the full reasoning lifecycle under one message id", async () => {
    const events = await runParts([
      { type: "reasoning-start", id: "r1" },
      { type: "reasoning-delta", id: "r1", delta: "Let me think..." },
      { type: "reasoning-delta", id: "r1", delta: " about this." },
      { type: "reasoning-end", id: "r1" },
    ]);

    expect(reasoningTypes(events)).toEqual([
      EventType.REASONING_START,
      EventType.REASONING_MESSAGE_START,
      EventType.REASONING_MESSAGE_CONTENT,
      EventType.REASONING_MESSAGE_CONTENT,
      EventType.REASONING_MESSAGE_END,
      EventType.REASONING_END,
    ]);
    const reasoningEvents = events.filter((event) =>
      reasoningLifecycle.includes(event.type),
    );
    expect(
      new Set(reasoningEvents.map((event) => eventField(event, "messageId"))),
    ).toEqual(new Set(["r1"]));
    expect(
      eventsOfType(events, EventType.REASONING_MESSAGE_START)[0],
    ).toMatchObject({ role: "reasoning" });
    expect(
      eventsOfType(events, EventType.REASONING_MESSAGE_CONTENT).map((event) =>
        eventField(event, "delta"),
      ),
    ).toEqual(["Let me think...", " about this."]);
    expect(events.at(-1)?.type).toBe(EventType.RUN_FINISHED);
  });

  it("closes reasoning before the text, under a different message id", async () => {
    const events = await runParts([
      ...reasoningParts("thinking", "r1"),
      ...textParts("Hello", "t1"),
    ]);

    const types = typesOf(events);
    expect(types.indexOf(EventType.REASONING_END)).toBeLessThan(
      types.indexOf(EventType.TEXT_MESSAGE_CHUNK),
    );
    const reasoningStart = eventsOfType(events, EventType.REASONING_START)[0];
    const textChunk = eventsOfType(events, EventType.TEXT_MESSAGE_CHUNK)[0];
    expect(eventField(reasoningStart, "messageId")).toBe("r1");
    expect(eventField(textChunk, "messageId")).toBe("t1");
  });

  it("opens and closes reasoning with no content for an empty reasoning block", async () => {
    const events = await runParts([
      { type: "reasoning-start", id: "r1" },
      { type: "reasoning-delta", id: "r1", delta: "" },
      { type: "reasoning-end", id: "r1" },
    ]);

    expect(reasoningTypes(events)).toEqual([
      EventType.REASONING_START,
      EventType.REASONING_MESSAGE_START,
      EventType.REASONING_MESSAGE_END,
      EventType.REASONING_END,
    ]);
    expect(events.at(-1)?.type).toBe(EventType.RUN_FINISHED);
  });

  it("emits no text for a reasoning-only answer", async () => {
    const events = await runParts(reasoningParts("Just thinking"));

    expect(eventsOfType(events, EventType.TEXT_MESSAGE_CHUNK)).toEqual([]);
    expect(eventsOfType(events, EventType.REASONING_MESSAGE_CONTENT)).toEqual([
      expect.objectContaining({ delta: "Just thinking" }),
    ]);
  });

  it("closes the first reasoning block when a second starts with no reasoning-end", async () => {
    const events = await runParts([
      { type: "reasoning-start", id: "r1" },
      { type: "reasoning-delta", id: "r1", delta: "First thought" },
      ...reasoningParts("Second thought", "r2"),
    ]);

    expect(reasoningTypes(events)).toEqual([
      ...reasoningLifecycle,
      ...reasoningLifecycle,
    ]);
    const starts = eventsOfType(events, EventType.REASONING_START);
    expect(starts.map((event) => eventField(event, "messageId"))).toEqual([
      "r1",
      "r2",
    ]);
    expect(events.at(-1)?.type).toBe(EventType.RUN_FINISHED);
  });

  it("closes reasoning before a tool call", async () => {
    const model = modelEmitting([
      ...reasoningParts("I need to call a tool"),
      toolCallPart("call1", "testTool", { arg: "val" }),
      finishPart("tool-calls"),
    ]);

    const events = await runAgent(aiSdkAgent({ model, tools: [testTool] }));

    const types = typesOf(events);
    expect(reasoningTypes(events)).toEqual(reasoningLifecycle);
    expect(types.indexOf(EventType.REASONING_END)).toBeLessThan(
      types.indexOf(EventType.TOOL_CALL_START),
    );
    expect(types).toContain(EventType.TOOL_CALL_END);
  });

  it.each([
    {
      name: "an error part",
      model: () =>
        modelEmitting([
          { type: "reasoning-start", id: "r1" },
          { type: "reasoning-delta", id: "r1", delta: "Thinking..." },
          { type: "error", error: new Error("stream broke") },
        ]),
    },
    {
      name: "a stream that throws",
      model: () =>
        new MockLanguageModelV3({
          doStream: async () => ({
            stream: streamThenThrow(
              [
                { type: "reasoning-start", id: "r1" },
                { type: "reasoning-delta", id: "r1", delta: "Thinking..." },
              ],
              new Error("unexpected network failure"),
            ),
          }),
        }),
    },
  ])("closes reasoning before RUN_ERROR on $name", async ({ model }) => {
    const agent = aiSdkAgent({ model: model() });

    const { events, errored } = await collectEventsIncludingErrors(
      agent.run(
        createDefaultInput({
          messages: [{ id: "u1", role: "user", content: "hi" }],
        }),
      ),
    );

    expect(errored).toBe(true);
    const types = typesOf(events);
    expect(reasoningTypes(events)).toEqual(reasoningLifecycle);
    expect(types.indexOf(EventType.REASONING_END)).toBeLessThan(
      types.indexOf(EventType.RUN_ERROR),
    );
  });

  it("closes reasoning when the run is aborted mid-reasoning", async () => {
    const model = modelStreamingUntilAborted([
      { type: "reasoning-start", id: "r1" },
      { type: "reasoning-delta", id: "r1", delta: "Thinking..." },
    ]);

    const events = await runAndAbortOn(
      aiSdkAgent({ model }),
      EventType.REASONING_MESSAGE_CONTENT,
    );

    expect(reasoningTypes(events)).toEqual(reasoningLifecycle);
    expect(eventsOfType(events, EventType.RUN_ERROR)).toEqual([]);
  });
});

describe("aiSdkAgent aborted run", () => {
  async function finishedEventOfAbortedRun(input: Partial<RunAgentInput>) {
    const model = modelStreamingUntilAborted(textParts("tick").slice(0, 2));
    const events = await runAndAbortOn(
      aiSdkAgent({ model }),
      EventType.TEXT_MESSAGE_CHUNK,
      input,
    );
    return eventsOfType(events, EventType.RUN_FINISHED)[0];
  }

  it("finishes an aborted run with outcome cancelled for a 1.0 client", async () => {
    const finished = await finishedEventOfAbortedRun({
      protocolVersion: "1.0",
    });

    expect(finished).toMatchObject({ outcome: { type: "cancelled" } });
  });

  it("finishes an aborted run with no outcome for a client that declares no version", async () => {
    const finished = await finishedEventOfAbortedRun({});

    expect(finished).toMatchObject({ type: EventType.RUN_FINISHED });
    expect(finished).not.toHaveProperty("outcome");
  });
});
