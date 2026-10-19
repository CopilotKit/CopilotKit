import { describe, expect, it } from "vitest";
import { EventType } from "@ag-ui/client";
import type {
  BaseEvent,
  Message,
  RunAgentInput,
  ToolCallResultEvent,
} from "@ag-ui/client";
import {
  BuiltInAgent,
  createAgent,
  collectEvents,
  createDefaultInput,
  mockTanStackStream,
} from "./agent-test-helpers";

const messages: Message[] = [
  {
    id: "assistant",
    role: "assistant",
    content: "",
    toolCalls: [
      {
        id: "approval",
        type: "function",
        function: { name: "bookFlight", arguments: "{}" },
      },
    ],
  },
];
function approvalInput(resume: RunAgentInput["resume"], history = messages) {
  return createDefaultInput({ runId: "new-run", messages: history, resume });
}
const decisions: {
  label: string;
  resume: RunAgentInput["resume"];
  content: string;
}[] = [
  {
    label: "approve",
    resume: [
      {
        interruptId: "approval",
        status: "resolved",
        payload: { approved: true },
      },
    ],
    content: '{"approved":true}',
  },
  {
    label: "deny",
    resume: [
      {
        interruptId: "approval",
        status: "resolved",
        payload: { approved: false },
      },
    ],
    content: '{"approved":false}',
  },
  {
    label: "cancel",
    resume: [{ interruptId: "approval", status: "cancelled" }],
    content: '{"status":"cancelled"}',
  },
];

describe.each(["aisdk", "tanstack"] as const)("%s approval history", (type) => {
  it.each(decisions)(
    "publishes $label exactly once before completion",
    async ({ resume, content }) => {
      const events = await collectEvents(
        createAgent(type, []).run(approvalInput(resume)),
      );
      expect(events.map((event) => event.type)).toEqual([
        EventType.RUN_STARTED,
        EventType.TOOL_CALL_RESULT,
        EventType.RUN_FINISHED,
      ]);
      expect(events[1]).toMatchObject({
        toolCallId: "approval",
        role: "tool",
        content,
      });
    },
  );

  it("does not publish a second answer already in input history", async () => {
    const history: Message[] = [
      ...messages,
      {
        id: "answer",
        role: "tool",
        toolCallId: "approval",
        content: '{"approved":true}',
      },
    ];
    const events = await collectEvents(
      createAgent(type, []).run(approvalInput(decisions[0]!.resume, history)),
    );
    expect(events.map((event) => event.type)).toEqual([
      EventType.RUN_STARTED,
      EventType.RUN_FINISHED,
    ]);
  });

  it("does not invent a tool result for an unknown interrupt", async () => {
    const events = await collectEvents(
      createAgent(type, []).run(
        approvalInput([
          { interruptId: "unknown", status: "resolved", payload: true },
        ]),
      ),
    );
    expect(events.map((event) => event.type)).toEqual([
      EventType.RUN_STARTED,
      EventType.RUN_FINISHED,
    ]);
  });
});

it("leaves custom confirmation results to the custom factory", async () => {
  const events = await collectEvents(
    createAgent("custom", []).run(approvalInput(decisions[0]!.resume)),
  );
  expect(events.map((event) => event.type)).toEqual([
    EventType.RUN_STARTED,
    EventType.RUN_FINISHED,
  ]);
});

it.each([false, true])(
  "suppresses an identical SDK echo with existing history %s",
  async (existing) => {
    const result: ToolCallResultEvent = {
      type: EventType.TOOL_CALL_RESULT,
      messageId: "echo",
      toolCallId: "approval",
      role: "tool",
      content: '{"approved":true}',
    };
    const history: Message[] = existing
      ? [
          ...messages,
          {
            id: "answer",
            role: "tool",
            toolCallId: "approval",
            content: '{"approved":true}',
          },
        ]
      : messages;
    const events = await collectEvents(
      createAgent("tanstack", [result]).run(
        approvalInput(decisions[0]!.resume, history),
      ),
    );
    expect(
      events.filter((event) => event.type === EventType.TOOL_CALL_RESULT),
    ).toHaveLength(existing ? 0 : 1);
  },
);

it("reports a conflicting SDK result instead of saving two answers", async () => {
  const result: ToolCallResultEvent = {
    type: EventType.TOOL_CALL_RESULT,
    messageId: "echo",
    toolCallId: "approval",
    role: "tool",
    content: '{"approved":false}',
  };
  await expect(
    collectEvents(
      createAgent("tanstack", [result]).run(
        approvalInput(decisions[0]!.resume),
      ),
    ),
  ).rejects.toThrow("Conflicting result for resumed tool call approval");
});

it("publishes identical duplicate decisions only once", async () => {
  const decision = { interruptId: "approval", status: "cancelled" } as const;
  const events = await collectEvents(
    createAgent("tanstack", []).run(approvalInput([decision, decision])),
  );
  expect(
    events.filter((event) => event.type === EventType.TOOL_CALL_RESULT),
  ).toHaveLength(1);
});

it("rejects conflicting decisions before publishing an answer", async () => {
  const events: BaseEvent[] = [];
  const agent = createAgent("tanstack", []);
  await new Promise<void>((resolve) =>
    agent
      .run(
        approvalInput([
          {
            interruptId: "approval",
            status: "resolved",
            payload: { approved: true },
          },
          { interruptId: "approval", status: "cancelled" },
        ]),
      )
      .subscribe({
        next: (event) => events.push(event),
        error: () => resolve(),
      }),
  );
  expect(events.map((event) => event.type)).toEqual([
    EventType.RUN_STARTED,
    EventType.RUN_ERROR,
  ]);
  expect(events[1]).toMatchObject({
    message: "Conflicting decisions for resumed tool call approval",
  });
});

it("saves accepted answers before Stop cancels model work", async () => {
  const events: BaseEvent[] = [];
  const agent = createAgent("tanstack", []);
  await new Promise<void>((resolve, reject) =>
    agent.run(approvalInput(decisions[0]!.resume)).subscribe({
      next: (event) => {
        events.push(event);
        if (event.type === EventType.TOOL_CALL_RESULT) agent.abortRun();
      },
      error: reject,
      complete: resolve,
    }),
  );
  expect(events.map((event) => event.type)).toEqual([
    EventType.RUN_STARTED,
    EventType.TOOL_CALL_RESULT,
  ]);
  expect(events[1]).toMatchObject({
    toolCallId: "approval",
    content: '{"approved":true}',
  });
});

it("uses the same accepted answer in saved history and model input", async () => {
  let received: RunAgentInput | undefined;
  const agent = new BuiltInAgent({
    type: "tanstack",
    factory: ({ input }) => {
      received = input;
      return mockTanStackStream([]);
    },
  });
  const events = await collectEvents(
    agent.run(approvalInput(decisions[0]!.resume)),
  );
  const answer = received?.messages.find((message) => message.role === "tool");
  expect(answer).toMatchObject({
    role: "tool",
    toolCallId: "approval",
    content: '{"approved":true}',
  });
  expect(events[1]).toMatchObject({
    type: EventType.TOOL_CALL_RESULT,
    messageId: answer?.id,
    toolCallId: "approval",
    content: '{"approved":true}',
  });
});
