import capturedHistories from "./fixtures/native-result-recovery-history.json";
import { nativeHistoryInput } from "../../handlers/intelligence/native-history-input";
import { AbstractAgent, EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import { firstValueFrom, from, of, toArray } from "rxjs";
import { expect, test } from "vitest";
import { NativeResultRecoveryMiddleware } from "../native-result-recovery";

const result = {
  id: "saved-result",
  role: "tool" as const,
  toolCallId: "call",
  content: "Friday at 10 AM",
};
const history = [
  {
    id: "assistant",
    role: "assistant",
    toolCalls: [{ id: "call", name: "scheduleTime", args: '{"duration":30}' }],
  },
  result,
];
const input: RunAgentInput = {
  threadId: "native-thread",
  runId: "run",
  messages: [{ id: "followup", role: "user", content: "Confirm my choice" }],
  state: {},
  tools: [],
  context: [],
  forwardedProps: {},
};
const pending = [
  { toolCallId: "call", toolName: "scheduleTime", arguments: { duration: 30 } },
];
class Backend extends AbstractAgent {
  inputs: RunAgentInput[] = [];
  constructor(
    private snapshots: unknown[],
    private failAfterPersist = false,
  ) {
    super();
  }
  run(value: RunAgentInput) {
    this.inputs.push(structuredClone(value));
    if (this.failAfterPersist && this.inputs.length === 2)
      return of<BaseEvent>({ type: EventType.RUN_ERROR, message: "ack lost" });
    return from<BaseEvent[]>([
      {
        type: EventType.RUN_STARTED,
        threadId: value.threadId,
        runId: value.runId,
      },
      {
        type: EventType.CUSTOM,
        name: "ag-ui:pending-frontend-results",
        value: this.snapshots.shift(),
      },
      {
        type: EventType.RUN_FINISHED,
        threadId: value.threadId,
        runId: value.runId,
      },
    ]);
  }
}
const snapshot = (items: unknown[] = pending) => ({
  version: 1,
  threadId: input.threadId,
  runId: input.runId,
  pending: items,
});
async function run(backend: Backend) {
  const middleware = new NativeResultRecoveryMiddleware(history);
  return firstValueFrom(middleware.run(input, backend).pipe(toArray()));
}
test("recovers the exact saved choice once only after a current trusted checkpoint", async () => {
  const backend = new Backend([snapshot(), snapshot([])]);
  const events = await run(backend);
  expect(backend.inputs).toHaveLength(2);
  expect(backend.inputs[0].messages).toEqual(input.messages);
  expect(backend.inputs[1].messages).toEqual([result]);
  expect(events.filter((e) => e.type === EventType.RUN_FINISHED)).toHaveLength(
    1,
  );
  expect(events.filter((e) => e.type === EventType.TOOL_CALL_RESULT)).toEqual([
    expect.objectContaining({
      messageId: result.id,
      toolCallId: result.toolCallId,
      content: result.content,
    }),
  ]);
});
test.each([
  snapshot([]),
  { ...snapshot(), runId: "old-run" },
  { ...snapshot(), threadId: "other-thread" },
  snapshot([{ ...pending[0], toolName: "serverTool" }]),
  snapshot([{ ...pending[0], arguments: { duration: 60 } }]),
  snapshot([pending[0], pending[0]]),
  { ...snapshot(), version: 2 },
])(
  "does not retry from a stale, ambiguous or mismatched checkpoint %#",
  async (value) => {
    const backend = new Backend([value]);
    await run(backend);
    expect(backend.inputs).toHaveLength(1);
  },
);
test("a lost acknowledgement after persistence does not retry again", async () => {
  const backend = new Backend([snapshot()], true);
  const events = await run(backend);
  expect(backend.inputs).toHaveLength(2);
  expect(events.some((e) => e.type === EventType.RUN_ERROR)).toBe(true);
  expect(events.some((e) => e.type === EventType.TOOL_CALL_RESULT)).toBe(false);
});

test("a still-pending result after retry stops instead of looping or claiming success", async () => {
  const backend = new Backend([snapshot(), snapshot()]);
  const events = await run(backend);
  expect(backend.inputs).toHaveLength(2);
  expect(events.some((e) => e.type === EventType.TOOL_CALL_RESULT)).toBe(false);
});
test("cold recovery after a lost acknowledgement with an empty checkpoint sends nothing", async () => {
  const backend = new Backend([snapshot([])]);
  await run(backend);
  expect(backend.inputs).toHaveLength(1);
});
test("never changes saved source messages", async () => {
  const before = structuredClone(history);
  await run(new Backend([snapshot(), snapshot([])]));
  expect(history).toEqual(before);
});

class EventsBackend extends AbstractAgent {
  calls = 0;
  constructor(private events: BaseEvent[]) {
    super();
  }
  run() {
    this.calls++;
    return from(this.events);
  }
}
const start = {
  type: EventType.RUN_STARTED,
  threadId: input.threadId,
  runId: input.runId,
};
const finish = {
  type: EventType.RUN_FINISHED,
  threadId: input.threadId,
  runId: input.runId,
};
const checkpoint = {
  type: EventType.CUSTOM,
  name: "ag-ui:pending-frontend-results",
  value: snapshot(),
};
test.each(
  [
    [start, checkpoint, checkpoint, finish],
    [checkpoint, start, finish],
    [start, checkpoint, { ...finish, runId: "old" }],
    [start, checkpoint, { ...finish, threadId: "other" }],
    [start, checkpoint, { type: EventType.RUN_ERROR, message: "save failed" }],
    [
      start,
      {
        type: EventType.TOOL_CALL_START,
        toolCallId: "call",
        toolCallName: "scheduleTime",
      },
      finish,
    ],
  ].map((events) => ({ events })),
)(
  "rejects replayed, incomplete or failed response handshakes %#",
  async ({ events }) => {
    const backend = new EventsBackend(events);
    await firstValueFrom(
      new NativeResultRecoveryMiddleware(history)
        .run(input, backend)
        .pipe(toArray()),
    );
    expect(backend.calls).toBe(1);
  },
);
test.each(
  [
    [...history, result],
    [
      ...history,
      { ...history[0], toolCalls: [{ id: "call", name: "other", args: "{}" }] },
    ],
    [
      {
        ...history[0],
        toolCalls: [{ id: "call", name: "scheduleTime", args: "not json" }],
      },
      result,
    ],
  ].map((saved) => ({ saved })),
)(
  "rejects ambiguous saved occurrences and invalid saved args %#",
  async ({ saved }) => {
    const backend = new Backend([snapshot()]);
    await firstValueFrom(
      new NativeResultRecoveryMiddleware(saved)
        .run(input, backend)
        .pipe(toArray()),
    );
    expect(backend.inputs).toHaveLength(1);
  },
);
test("empty args match a native no-argument call", async () => {
  const backend = new Backend([
    snapshot([{ ...pending[0], arguments: {} }]),
    snapshot([]),
  ]);
  const saved = [
    {
      ...history[0],
      toolCalls: [{ id: "call", name: "scheduleTime", args: "" }],
    },
    result,
  ];
  await firstValueFrom(
    new NativeResultRecoveryMiddleware(saved)
      .run(input, backend)
      .pipe(toArray()),
  );
  expect(backend.inputs[1].messages).toEqual([result]);
});
test("does not duplicate a real canonical result already emitted by the backend", async () => {
  const backend = new EventsBackend([
    start,
    {
      type: EventType.TOOL_CALL_RESULT,
      messageId: result.id,
      toolCallId: result.toolCallId,
      content: result.content,
    },
    checkpoint,
    finish,
  ]);
  const events = await firstValueFrom(
    new NativeResultRecoveryMiddleware(history)
      .run(input, backend)
      .pipe(toArray()),
  );
  expect(backend.calls).toBe(1);
  expect(
    events.filter((event) => event.type === EventType.TOOL_CALL_RESULT),
  ).toHaveLength(1);
});

test("recovers saved results when native replay added an identical assistant alias", async () => {
  const saved = [
    ...history,
    {
      id: "assistant-call",
      role: "assistant",
      toolCalls: [
        { id: "call", name: "scheduleTime", args: '{ "duration": 30 }' },
      ],
    },
  ];
  const backend = new Backend([snapshot(), snapshot([])]);
  await firstValueFrom(
    new NativeResultRecoveryMiddleware(saved)
      .run(input, backend)
      .pipe(toArray()),
  );
  expect(backend.inputs).toHaveLength(2);
  expect(backend.inputs[1].messages).toEqual([result]);
});

test.each(capturedHistories)(
  "recovers the actual $threadId replay aliases without rewriting results",
  async (fixture) => {
    const call = fixture.history
      .flatMap((message) =>
        "toolCalls" in message ? (message.toolCalls ?? []) : [],
      )
      .find((item) => item.name === "scheduleTime")!;
    const saved = fixture.history.find(
      (message) => "toolCallId" in message && message.toolCallId === call.id,
    )!;
    const backend = new Backend([
      snapshot([
        {
          toolCallId: call.id,
          toolName: call.name,
          arguments: JSON.parse(call.args),
        },
      ]),
      snapshot([]),
    ]);
    await firstValueFrom(
      new NativeResultRecoveryMiddleware(fixture.history)
        .run(input, backend)
        .pipe(toArray()),
    );
    expect(backend.inputs).toHaveLength(2);
    expect(backend.inputs[1].messages).toEqual([saved]);
    const aliases = fixture.history.filter(
      (message) =>
        "toolCalls" in message &&
        message.toolCalls?.some((item) => item.id === call.id),
    );
    const original = aliases[0];
    const latest = aliases
      .flatMap((message) =>
        "toolCalls" in message ? (message.toolCalls ?? []) : [],
      )
      .filter((item) => item.id === call.id)
      .at(-1)!;
    expect(() =>
      nativeHistoryInput(
        [
          {
            id: original.id,
            role: "assistant",
            content: "content" in original ? original.content : undefined,
            toolCalls: [
              {
                id: call.id,
                type: "function",
                function: { name: call.name, arguments: latest.args },
              },
            ],
          },
        ],
        fixture.history,
      ),
    ).not.toThrow();
  },
);

test.each(["null", "[]", "22", '"value"', '{"duration":60}'])(
  "rejects a contradictory or nonobject argument alias %s",
  async (args) => {
    const backend = new Backend([snapshot()]);
    const saved = [
      ...history,
      {
        id: "alias",
        role: "assistant",
        toolCalls: [{ id: "call", name: "scheduleTime", args }],
      },
    ];
    await firstValueFrom(
      new NativeResultRecoveryMiddleware(saved)
        .run(input, backend)
        .pipe(toArray()),
    );
    expect(backend.inputs).toHaveLength(1);
  },
);
