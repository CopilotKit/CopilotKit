import { describe, it, expect } from "vitest";
import type {
  BaseEvent,
  Message,
  MessagesSnapshotEvent,
  RunAgentInput,
} from "@ag-ui/client";
import { AbstractAgent, EventType } from "@ag-ui/client";
import { Observable, firstValueFrom } from "rxjs";
import { toArray } from "rxjs/operators";
import {
  OpenGenerativeUIMiddleware,
  projectOpenGenerativeUIHistory,
} from "../open-generative-ui-middleware";

const ACTIVITY_TYPE = "open-generative-ui";

class MockAgent extends AbstractAgent {
  public receivedInput: RunAgentInput | null = null;

  constructor(private readonly events: BaseEvent[]) {
    super();
  }

  run(input: RunAgentInput): Observable<BaseEvent> {
    this.receivedInput = input;
    return new Observable<BaseEvent>((subscriber) => {
      for (const event of this.events) subscriber.next(event);
      subscriber.complete();
    });
  }

  clone(): AbstractAgent {
    return new MockAgent([...this.events]);
  }

  protected connect(): ReturnType<AbstractAgent["connect"]> {
    throw new Error("not used");
  }
}

function runInput(overrides: Partial<RunAgentInput> = {}): RunAgentInput {
  return {
    threadId: "thread-1",
    runId: "run-1",
    state: {},
    messages: [],
    tools: [],
    context: [],
    forwardedProps: undefined,
    ...overrides,
  };
}

function snapshot(messages: Message[]): MessagesSnapshotEvent {
  return { type: EventType.MESSAGES_SNAPSHOT, messages };
}

const args = {
  initialHeight: 200,
  html: "<main>Saved</main>",
  css: "main { color: white }",
  jsFunctions: 'function neverRun() { throw new Error("must not execute") }',
  jsExpressions: ["neverRun()"],
};

function sandboxCall(callId: string): Message {
  return {
    id: `${callId}-assistant`,
    role: "assistant",
    toolCalls: [
      {
        id: callId,
        type: "function",
        function: {
          name: "generateSandboxedUi",
          arguments: JSON.stringify(args),
        },
      },
    ],
  };
}

const activities = (messages: Message[]) =>
  messages.filter((m) => m.role === "activity");

describe("projectOpenGenerativeUIHistory", () => {
  it.each(["complete", "failed", "interrupted"] as const)(
    "restores a %s call from its final arguments without executing host code",
    (status) => {
      const callId = `call-${status}`;
      const messages: Message[] = [sandboxCall(callId)];
      if (status !== "interrupted") {
        messages.push({
          id: `${callId}-result`,
          role: "tool",
          toolCallId: callId,
          content: "Finished",
          ...(status === "failed" ? { error: "Host failed" } : {}),
        });
      }

      const projected = projectOpenGenerativeUIHistory(snapshot(messages));

      expect(activities(projected.messages)).toEqual([
        expect.objectContaining({
          id: `${callId}-activity`,
          role: "activity",
          activityType: ACTIVITY_TYPE,
          content: expect.objectContaining({
            generating: false,
            status,
            html: [args.html],
            htmlComplete: true,
            css: args.css,
            jsFunctions: args.jsFunctions,
            jsExpressions: args.jsExpressions,
            initialHeight: 200,
            ...(status === "failed" ? { error: "Host failed" } : {}),
          }),
        }),
      ]);
      expect(projected.messages.map((m) => m.role)).toEqual(
        status === "interrupted"
          ? ["assistant", "activity"]
          : ["assistant", "activity", "tool"],
      );
    },
  );

  it("declares its own activity type as authoritative and keeps other owners", () => {
    const projected = projectOpenGenerativeUIHistory({
      ...snapshot([sandboxCall("call")]),
      metadata: {
        "@ag-ui/client": { authoritativeActivityTypes: ["other"] },
        keep: true,
      },
    });

    expect(projected.metadata).toEqual({
      keep: true,
      "@ag-ui/client": { authoritativeActivityTypes: ["other", ACTIVITY_TYPE] },
    });
  });

  it("replaces stale activity of its own type and is idempotent", () => {
    const stale: Message = {
      id: "call-activity",
      role: "activity",
      activityType: ACTIVITY_TYPE,
      content: { generating: true },
    };
    const foreign: Message = {
      id: "foreign",
      role: "activity",
      activityType: "other",
      content: {},
    };
    const projected = projectOpenGenerativeUIHistory(
      snapshot([stale, sandboxCall("call"), foreign]),
    );

    expect(projected.messages.map((m) => m.id)).toEqual([
      "call-assistant",
      "call-activity",
      "foreign",
    ]);
    expect(projectOpenGenerativeUIHistory(projected)).toEqual(projected);
  });
});

describe("OpenGenerativeUIMiddleware snapshots", () => {
  async function collect(
    observable: Observable<BaseEvent>,
  ): Promise<BaseEvent[]> {
    return firstValueFrom(observable.pipe(toArray()));
  }

  const framed = (event: BaseEvent): BaseEvent[] => [
    {
      type: EventType.RUN_STARTED,
      threadId: "thread-1",
      runId: "run-1",
    } as BaseEvent,
    event,
    {
      type: EventType.RUN_FINISHED,
      threadId: "thread-1",
      runId: "run-1",
    } as BaseEvent,
  ];

  it("delivers one completed tool call with all arguments after a lagging snapshot", async () => {
    const prefix = '{"html":"<main>Live';
    const complete = prefix + '</main>"}';
    const agent = new MockAgent([
      {
        type: EventType.RUN_STARTED,
        threadId: "thread-1",
        runId: "run-1",
      } as BaseEvent,
      {
        type: EventType.TOOL_CALL_START,
        toolCallId: "live",
        toolCallName: "generateSandboxedUi",
        parentMessageId: "assistant",
      } as BaseEvent,
      {
        type: EventType.TOOL_CALL_ARGS,
        toolCallId: "live",
        delta: prefix,
      } as BaseEvent,
      snapshot([]),
      {
        type: EventType.TOOL_CALL_ARGS,
        toolCallId: "live",
        delta: '</main>"}',
      } as BaseEvent,
      { type: EventType.TOOL_CALL_END, toolCallId: "live" } as BaseEvent,
      {
        type: EventType.RUN_FINISHED,
        threadId: "thread-1",
        runId: "run-1",
      } as BaseEvent,
    ]);
    agent.use(new OpenGenerativeUIMiddleware());
    const calls: string[] = [];
    await agent.runAgent(runInput(), {
      onNewToolCall: ({ toolCall }) => {
        calls.push(toolCall.function.arguments);
      },
    });
    expect(calls).toEqual([complete]);
    expect(activities(agent.messages)[0]?.content).toMatchObject({
      generating: false,
    });
  });

  it.each([EventType.RUN_ERROR, EventType.RUN_FINISHED])(
    "settles partial presentation before %s",
    async (type) => {
      const events = await collect(
        new OpenGenerativeUIMiddleware().run(
          runInput(),
          new MockAgent([
            {
              type: EventType.RUN_STARTED,
              threadId: "thread-1",
              runId: "run-1",
            } as BaseEvent,
            {
              type: EventType.TOOL_CALL_START,
              toolCallId: "live",
              toolCallName: "generateSandboxedUi",
            } as BaseEvent,
            {
              type: EventType.TOOL_CALL_ARGS,
              toolCallId: "live",
              delta: '{"html":"partial',
            } as BaseEvent,
            snapshot([]),
            {
              type,
              message: "interrupted",
              threadId: "thread-1",
              runId: "run-1",
            } as BaseEvent,
          ]),
        ),
      );
      expect(events.slice(0, -1)).toContainEqual(
        expect.objectContaining({
          type: EventType.ACTIVITY_DELTA,
          messageId: "live-activity",
          patch: [{ op: "add", path: "/generating", value: false }],
        }),
      );
      expect(events.at(-1)?.type).toBe(type);
      expect(
        events.some((event) => event.type === EventType.TOOL_CALL_RESULT),
      ).toBe(false);
    },
  );

  it("preserves live HTML and generation state across lagging snapshots", async () => {
    const prefix = '{"html":"<main>Live';
    const call: Message = {
      id: "assistant",
      role: "assistant",
      toolCalls: [
        {
          id: "live",
          type: "function",
          function: { name: "generateSandboxedUi", arguments: prefix },
        },
      ],
    };
    const later: Message = { id: "later", role: "assistant", content: "Done" };
    const result: Message = {
      id: "result",
      role: "tool",
      toolCallId: "live",
      content: "ok",
    };
    const source: BaseEvent[] = [
      {
        type: EventType.RUN_STARTED,
        threadId: "thread-1",
        runId: "run-1",
      } as BaseEvent,
      {
        type: EventType.TOOL_CALL_START,
        toolCallId: "live",
        toolCallName: "generateSandboxedUi",
        parentMessageId: "assistant",
      } as BaseEvent,
      {
        type: EventType.TOOL_CALL_ARGS,
        toolCallId: "live",
        delta: prefix,
      } as BaseEvent,
      snapshot([call]),
      snapshot([]),
      {
        type: EventType.TOOL_CALL_ARGS,
        toolCallId: "live",
        delta: '</main>"}',
      } as BaseEvent,
      { type: EventType.TOOL_CALL_END, toolCallId: "live" } as BaseEvent,
      {
        type: EventType.TOOL_CALL_RESULT,
        toolCallId: "live",
        messageId: "result",
        content: "ok",
      } as BaseEvent,
      snapshot([call, later]),
      snapshot([call, result, later]),
      snapshot([call, result, later]),
      snapshot([result, later]),
      snapshot([call, { ...result, error: "Render failed" }, later]),
      snapshot([sandboxCall("live"), result]),
      {
        type: EventType.RUN_FINISHED,
        threadId: "thread-1",
        runId: "run-1",
      } as BaseEvent,
    ];
    const events = await collect(
      new OpenGenerativeUIMiddleware().run(runInput(), new MockAgent(source)),
    );
    const snapshots = events.filter(
      (event): event is MessagesSnapshotEvent =>
        event.type === EventType.MESSAGES_SNAPSHOT,
    );
    for (const current of snapshots.slice(0, 2)) {
      expect(activities(current.messages)).toEqual([
        expect.objectContaining({
          id: "live-activity",
          content: expect.objectContaining({
            html: ["<main>Live"],
            generating: true,
          }),
        }),
      ]);
      expect(activities(current.messages)[0]?.content).not.toHaveProperty(
        "htmlComplete",
      );
      expect(activities(current.messages)[0]?.content).not.toHaveProperty(
        "status",
        "interrupted",
      );
    }
    expect(snapshots[2].messages).toContainEqual(result);
    expect(
      snapshots[2].messages
        .filter((message) => message.role !== "activity")
        .map((message) => message.id),
    ).toEqual(["assistant", "result", "later"]);
    expect(activities(snapshots[2].messages)[0]?.content).toMatchObject({
      html: ["<main>Live", "</main>"],
      htmlComplete: true,
      generating: false,
    });
    for (const current of snapshots.slice(2, 6)) {
      expect(activities(current.messages)[0]?.content).toMatchObject({
        html: ["<main>Live", "</main>"],
        generating: false,
        status: "complete",
      });
      const owner = current.messages.find(
        (message) => message.id === "assistant",
      );
      expect(owner).toMatchObject({
        toolCalls: [{ function: { arguments: prefix + '</main>"}' } }],
      });
      expect(
        current.messages.filter((message) => message.id === "result"),
      ).toHaveLength(1);
    }
    expect(activities(snapshots[6].messages)[0]?.content).toMatchObject({
      status: "failed",
      error: "Render failed",
      generating: false,
      html: ["<main>Live", "</main>"],
    });
    expect(snapshots[7]).toEqual(
      projectOpenGenerativeUIHistory(snapshot([sandboxCall("live"), result])),
    );
  });

  it("projects every forwarded snapshot during a live run", async () => {
    const source = snapshot([sandboxCall("call")]);
    const agent = new MockAgent(framed(source));

    const events = await collect(
      new OpenGenerativeUIMiddleware().run(runInput(), agent),
    );

    expect(events.find((e) => e.type === EventType.MESSAGES_SNAPSHOT)).toEqual(
      projectOpenGenerativeUIHistory(source),
    );
  });
});

describe("activity snapshot authority", () => {
  it.each([undefined, null])(
    "preserves full authority when the last activity is removed (%s)",
    (scope) => {
      const source = snapshot([
        {
          id: "obsolete",
          role: "activity",
          activityType: "open-generative-ui",
          content: {},
        },
      ]);
      if (scope === null)
        source.metadata = {
          "@ag-ui/client": { authoritativeActivityTypes: null },
        };
      const projected = projectOpenGenerativeUIHistory(source);
      expect(projected.messages).toEqual([]);
      expect(projected.metadata?.["@ag-ui/client"]).toEqual({
        authoritativeActivityTypes: null,
      });
      expect(projectOpenGenerativeUIHistory(projected)).toEqual(projected);
    },
  );

  it.each([{ scope: [] }, { scope: ["other"] }])(
    "extends only explicit partial authority ($scope)",
    ({ scope }) => {
      const source = snapshot([
        {
          id: "file",
          role: "activity",
          activityType: "dsh-deliverables",
          content: {},
        },
      ]);
      source.metadata = {
        "@ag-ui/client": { authoritativeActivityTypes: scope },
      };
      const projected = projectOpenGenerativeUIHistory(source);
      expect(projected.messages).toEqual(source.messages);
      expect(projected.metadata?.["@ag-ui/client"]).toEqual({
        authoritativeActivityTypes: [...scope, "open-generative-ui"],
      });
    },
  );
});
