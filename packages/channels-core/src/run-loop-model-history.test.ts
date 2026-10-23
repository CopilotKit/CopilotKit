import { EventType, HttpAgent } from "@ag-ui/client";
import type { Message, RunAgentInput, ToolCall } from "@ag-ui/core";
import { expect, test } from "vitest";
import { runAgentLoop } from "./run-loop.js";
import type { RunLoopArgs } from "./run-loop.js";
import { makeFakeRunRenderer } from "./testing/fake-adapter.js";

/** Records real HTTP inputs while the agent completes without adding messages. */
function setup(messages: Message[]) {
  const inputs: RunAgentInput[] = [];
  const agent = new HttpAgent({
    url: "https://agent.example.test/run",
    threadId: "thread",
    initialMessages: messages,
    fetch: async (_url, init) => {
      const input: RunAgentInput = JSON.parse(String(init?.body));
      inputs.push(input);
      const events = [EventType.RUN_STARTED, EventType.RUN_FINISHED].map(
        (type) => ({ type, threadId: input.threadId, runId: input.runId }),
      );
      return new Response(
        events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
        { headers: { "Content-Type": "text/event-stream" } },
      );
    },
  });
  const run = (initialResume?: RunLoopArgs["initialResume"]) =>
    runAgentLoop({
      agent,
      renderer: makeFakeRunRenderer(),
      tools: new Map(),
      toolDescriptors: [],
      context: [],
      initialResume,
      makeToolCtx: () => {
        throw new Error("No frontend tool should execute in this fixture");
      },
    });
  return { agent, inputs, run };
}

test("sends completed adjacent tool exchanges without changing canonical pending history", async () => {
  const completed: ToolCall = {
    id: "completed",
    type: "function",
    function: { name: "search", arguments: "{}" },
    metadata: { provider: "retained" },
  };
  const pending: ToolCall = {
    id: "pending",
    type: "function",
    function: { name: "confirm", arguments: "{}" },
  };
  const messages: Message[] = [
    {
      id: "assistant",
      role: "assistant",
      content: "Searching",
      toolCalls: [completed, pending],
    },
    {
      id: "activity",
      role: "activity",
      activityType: "progress",
      content: { status: "working" },
    },
    { id: "interlude", role: "assistant", content: "Still working" },
    {
      id: "result",
      role: "tool",
      toolCallId: "completed",
      content: "Found",
      metadata: { provider: "retained" },
    },
    { id: "user", role: "user", content: "Continue" },
  ];
  const { agent, inputs, run } = setup(messages);

  await run();

  expect(inputs[0]?.messages).toEqual([
    { ...messages[0], toolCalls: [completed] },
    messages[3],
    messages[2],
    messages[4],
  ]);
  expect(agent.messages).toEqual(messages);
});

test.each(["", "Awaiting confirmation"])(
  "retains a pending call with content %j for a later resume result",
  async (content) => {
    const call: ToolCall = {
      id: "confirm",
      type: "function",
      function: { name: "confirm", arguments: "{}" },
    };
    const messages: Message[] = [
      { id: "request", role: "assistant", content, toolCalls: [call] },
      { id: "user", role: "user", content: "Approved" },
    ];
    const { agent, inputs, run } = setup(messages);

    await run();

    expect(inputs[0]?.messages).toEqual([
      ...(content ? [{ id: "request", role: "assistant", content }] : []),
      messages[1],
    ]);
    expect(agent.messages).toEqual(messages);

    const result: Message = {
      id: "confirmation",
      role: "tool",
      toolCallId: call.id,
      content: "Approved",
    };
    agent.addMessage(result);
    const canonical = structuredClone(agent.messages);

    await run({ resume: "Approved" });

    expect(inputs[1]?.messages).toEqual([messages[0], result, messages[1]]);
    expect(inputs[1]?.forwardedProps).toEqual({
      command: { resume: "Approved" },
    });
    expect(agent.messages).toEqual(canonical);
  },
);

test("matches reused call IDs to their preceding execution and omits orphan results only from model input", async () => {
  const call: ToolCall = {
    id: "reused",
    type: "function",
    function: { name: "search", arguments: "{}" },
  };
  const messages: Message[] = [
    { id: "orphan", role: "tool", toolCallId: "missing", content: "Lost call" },
    { id: "first", role: "assistant", toolCalls: [call] },
    { id: "first-result", role: "tool", toolCallId: call.id, content: "First" },
    { id: "user", role: "user", content: "Search again" },
    {
      id: "second",
      role: "assistant",
      toolCalls: [
        { ...call, function: { name: "search", arguments: '{"q":"new"}' } },
      ],
    },
    { id: "interlude", role: "assistant", content: "Searching again" },
    {
      id: "second-result",
      role: "tool",
      toolCallId: call.id,
      content: "Second",
    },
  ];
  const { agent, inputs, run } = setup(messages);

  await run();

  expect(inputs[0]?.messages).toEqual([
    messages[1],
    messages[2],
    messages[3],
    messages[4],
    messages[6],
    messages[5],
  ]);
  expect(agent.messages).toEqual(messages);
});
