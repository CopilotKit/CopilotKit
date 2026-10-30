import { describe, expect, it } from "vitest";
import type { AssistantMessage, Message, ToolMessage } from "@ag-ui/core";
import {
  countFailedToolCalls,
  formatReasoningDuration,
  formatToolNames,
  formatWorkDuration,
  getArgumentPreview,
  getLatestTurnKey,
  getToolCallLayouts,
  getToolCallPreview,
  getToolCallRendererNames,
  getToolCallRowStatus,
  getTurnWork,
  getWorkOpenState,
  isTurnWorkOpen,
  pluralize,
  recordWorkTime,
  stringifyToolCallPayload,
} from "../tool-call-layout";
import type {
  ToolCallEntry,
  ToolCallRendererNames,
  ToolCallSegment,
  WorkTime,
} from "../tool-call-layout";

const question: Message = { id: "u1", role: "user", content: "Why?" };

const callMessage = (
  id: string,
  name = "run_command",
  args = JSON.stringify({ command: `cmd ${id}` }),
): AssistantMessage => ({
  id: `m-${id}`,
  role: "assistant",
  content: "",
  toolCalls: [{ id, type: "function", function: { name, arguments: args } }],
});

const result = (id: string, error?: string): ToolMessage => ({
  id: `r-${id}`,
  role: "tool",
  toolCallId: id,
  content: "ok",
  ...(error ? { error } : {}),
});

const say = (id: string, content: string): Message => ({
  id,
  role: "assistant",
  content,
});

const entry = (
  id: string,
  name = "run_command",
  toolMessage?: ToolMessage,
): ToolCallEntry => ({
  toolCall: callMessage(id, name).toolCalls![0]!,
  toolMessage,
});

/** A wildcard that groups, plus `weather` with a renderer of its own. */
const names: ToolCallRendererNames = {
  named: new Set(["weather"]),
  groupedNames: new Set(),
  wildcard: true,
  wildcardGroups: true,
};

const layoutsOf = (messages: Message[], renderers = names) =>
  getToolCallLayouts(messages, messages, renderers);

/** Each segment as `kind:id,id`, so a test reads the shape in one line. */
const describeSegments = (segments: readonly ToolCallSegment[]) =>
  segments.map((segment) =>
    segment.kind === "group"
      ? `group:${segment.calls.map((call) => call.toolCall.id).join(",")}`
      : `call:${segment.call.toolCall.id}${segment.rendered ? "" : "(none)"}`,
  );

const shapeOf = (messages: Message[], renderers = names) => {
  const layouts = layoutsOf(messages, renderers);
  return Object.fromEntries(
    [...layouts].map(([id, layout]) => [id, describeSegments(layout.segments)]),
  );
};

const summarize = (result: ToolCallRendererNames) => ({
  named: [...result.named].sort(),
  groupedNames: [...result.groupedNames].sort(),
  wildcard: result.wildcard,
  wildcardGroups: result.wildcardGroups,
});

describe("getToolCallLayouts", () => {
  it("groups calls made in a row across messages, owned by the first", () => {
    const messages = [
      question,
      callMessage("a"),
      result("a"),
      callMessage("b"),
      result("b"),
    ];
    const layouts = layoutsOf(messages);

    expect(layouts.get("m-a")!.segments[0]).toMatchObject({
      kind: "group",
      trailing: true,
    });
    expect(shapeOf(messages)).toEqual({ "m-a": ["group:a,b"], "m-b": [] });
  });

  it("starts a new group after text or a call with its own renderer", () => {
    const messages = [
      question,
      callMessage("a"),
      say("t", "Checking more."),
      callMessage("b"),
      callMessage("w", "weather"),
      callMessage("c"),
    ];
    expect(shapeOf(messages)).toEqual({
      "m-a": ["group:a"],
      t: [],
      "m-b": ["group:b"],
      "m-w": ["call:w"],
      "m-c": ["group:c"],
    });
  });

  it("closes the group at a user message and marks only the last group trailing", () => {
    const messages = [
      question,
      callMessage("a"),
      { id: "u2", role: "user", content: "And?" } satisfies Message,
      callMessage("b"),
    ];
    const layouts = layoutsOf(messages);
    expect(layouts.get("m-a")!.segments[0]).toMatchObject({ trailing: false });
    expect(layouts.get("m-b")!.segments[0]).toMatchObject({ trailing: true });
  });

  it("keeps a call with no renderer out of the group without splitting it", () => {
    const noWildcard: ToolCallRendererNames = {
      named: new Set(["search"]),
      groupedNames: new Set(["search"]),
      wildcard: false,
      wildcardGroups: false,
    };
    const messages = [
      question,
      callMessage("a", "search"),
      callMessage("x", "unknown"),
      callMessage("b", "search"),
    ];
    expect(shapeOf(messages, noWildcard)).toEqual({
      "m-a": ["group:a,b"],
      "m-x": ["call:x(none)"],
      "m-b": [],
    });
  });

  it("keeps a call repeated while streaming at its first position, with its last arguments", () => {
    const message: AssistantMessage = {
      id: "m-1",
      role: "assistant",
      content: "",
      toolCalls: [
        { id: "a", type: "function", function: { name: "x", arguments: "{" } },
        { id: "b", type: "function", function: { name: "y", arguments: "{}" } },
        {
          id: "a",
          type: "function",
          function: { name: "x", arguments: '{"q":1}' },
        },
      ],
    };
    const group = layoutsOf([question, message]).get("m-1")!.segments[0]!;
    const calls = group.kind === "group" ? group.calls : [];
    expect(
      calls.map((call) => [call.toolCall.id, call.toolCall.function.arguments]),
    ).toEqual([
      ["a", '{"q":1}'],
      ["b", "{}"],
    ]);
  });

  it("finds results in all messages when the rendered list hides them", () => {
    const rendered = [question, callMessage("a")];
    const all = [...rendered, result("a")];
    const group = getToolCallLayouts(rendered, all, names).get("m-a")!
      .segments[0]!;
    expect(group.kind === "group" && group.calls[0]!.toolMessage?.id).toBe(
      "r-a",
    );
  });

  it("changes its signature when a result arrives for a call it holds", () => {
    const before = [question, callMessage("a"), callMessage("b")];
    const after = [...before, result("b")];
    const signature = (messages: Message[]) =>
      layoutsOf(messages).get("m-a")!.signature;
    expect(signature(after)).not.toBe(signature(before));
  });
});

describe("getTurnWork", () => {
  it("treats everything up to the last call as work, and the rest as the reply", () => {
    const messages = [
      question,
      say("t1", "Looking."),
      callMessage("a"),
      result("a"),
      say("t2", "The answer."),
    ];
    const turn = getTurnWork(messages, layoutsOf(messages)).get("u1")!;
    expect([...turn.workMessageIds]).toEqual(["t1", "m-a"]);
    expect(turn.firstMessageId).toBe("t1");
    expect(turn.calls.map((call) => call.toolCall.id)).toEqual(["a"]);
    expect(turn.replyTextMessageId).toBeUndefined();
    expect(turn.isLatest).toBe(true);
  });

  it("marks the answer that shares a message with the last call", () => {
    const answerWithCall: AssistantMessage = {
      ...callMessage("a"),
      id: "answer",
      content: "Here it is.",
    };
    const messages = [question, answerWithCall];
    const turn = getTurnWork(messages, layoutsOf(messages)).get("u1")!;
    expect(turn.replyTextMessageId).toBe("answer");
    expect([...turn.workMessageIds]).toEqual(["answer"]);
  });

  it("leaves out an earlier reply with no calls but keeps the latest one", () => {
    const messages = [say("hello", "Hi."), question, say("t", "Thinking.")];
    const turns = getTurnWork(messages, layoutsOf(messages));
    expect([...turns.keys()]).toEqual(["u1"]);
    expect([...turns.get("u1")!.workMessageIds]).toEqual([]);
  });

  it("keys a reply that no user message starts as start", () => {
    const messages = [callMessage("a")];
    expect([...getTurnWork(messages, layoutsOf(messages)).keys()]).toEqual([
      "start",
    ]);
  });
});

describe("getToolCallRendererNames", () => {
  const renderers = [
    { name: "*", group: true },
    { name: "search", group: true },
    { name: "weather" },
  ];

  it("reads registered renderers and their group opt-in (React)", () => {
    expect(summarize(getToolCallRendererNames(renderers))).toEqual({
      named: ["search", "weather"],
      groupedNames: ["search"],
      wildcard: true,
      wildcardGroups: true,
    });
  });

  it("reports no wildcard when none is registered", () => {
    expect(summarize(getToolCallRendererNames([{ name: "search" }]))).toEqual({
      named: ["search"],
      groupedNames: [],
      wildcard: false,
      wildcardGroups: false,
    });
  });

  it("names a tool-call-<name> slot's tool and never groups it (Vue)", () => {
    const result = getToolCallRendererNames(renderers, {
      slotNames: ["tool-call-search", "tool-call-files", "header"],
    });
    expect(summarize(result)).toEqual({
      named: ["files", "search", "weather"],
      groupedNames: [],
      wildcard: true,
      wildcardGroups: true,
    });
  });

  it("treats a tool-call slot as a wildcard that turns grouping off (Vue)", () => {
    const result = getToolCallRendererNames([{ name: "search", group: true }], {
      slotNames: ["tool-call"],
    });
    expect(summarize(result)).toEqual({
      named: ["search"],
      groupedNames: [],
      wildcard: true,
      wildcardGroups: false,
    });
  });

  it("names extra tools without grouping them, and groups the built-in card (Angular)", () => {
    const result = getToolCallRendererNames([{ name: "search", group: true }], {
      extraNamed: ["client_tool", "approve"],
      builtInWildcard: { enabled: true, groups: true },
    });
    expect(summarize(result)).toEqual({
      named: ["approve", "client_tool", "search"],
      groupedNames: ["search"],
      wildcard: true,
      wildcardGroups: true,
    });
  });

  it("lets an app wildcard's group choice win over the built-in card (Angular)", () => {
    const result = getToolCallRendererNames([{ name: "*" }], {
      builtInWildcard: { enabled: true, groups: true },
    });
    expect(result.wildcard).toBe(true);
    expect(result.wildcardGroups).toBe(false);
  });

  it("adds no wildcard when the built-in card is off (Angular)", () => {
    const result = getToolCallRendererNames([], {
      builtInWildcard: { enabled: false, groups: true },
    });
    expect(result.wildcard).toBe(false);
    expect(result.wildcardGroups).toBe(false);
  });
});

describe("turn open state", () => {
  const state = (overrides: Partial<Parameters<typeof isTurnWorkOpen>[1]>) => ({
    toggledTurns: new Map<string, boolean>(),
    isRunning: true,
    latestTurnKey: "u2",
    ...overrides,
  });

  it("finds the latest turn key from the last user message", () => {
    expect(
      getLatestTurnKey([question, say("a", "x"), { ...question, id: "u2" }]),
    ).toBe("u2");
    expect(getLatestTurnKey([say("a", "x")])).toBe("start");
  });

  it("opens only the latest turn while running, unless the user toggled it", () => {
    expect(isTurnWorkOpen("u2", state({}))).toBe(true);
    expect(isTurnWorkOpen("u1", state({}))).toBe(false);
    expect(isTurnWorkOpen("u2", state({ isRunning: false }))).toBe(false);
    expect(
      isTurnWorkOpen("u2", state({ toggledTurns: new Map([["u2", false]]) })),
    ).toBe(false);
    expect(
      isTurnWorkOpen(
        "u1",
        state({ isRunning: false, toggledTurns: new Map([["u1", true]]) }),
      ),
    ).toBe(true);
  });

  it("keeps the answer text out of the open work", () => {
    const messages = [
      question,
      say("t1", "Looking."),
      { ...callMessage("a"), id: "answer", content: "Done." },
    ];
    const turns = getTurnWork(messages, layoutsOf(messages)).values();
    const { workOpen, workTextOpen } = getWorkOpenState(
      turns,
      state({ latestTurnKey: "u1" }),
    );
    expect([...workOpen]).toEqual([
      ["t1", true],
      ["answer", true],
    ]);
    expect([...workTextOpen]).toEqual([["t1", true]]);
  });
});

describe("recordWorkTime", () => {
  const record = (
    workTimes: Map<string, WorkTime>,
    isRunning: boolean,
    now: number,
    lastMessageRole: Message["role"] = "assistant",
  ) =>
    recordWorkTime(workTimes, {
      isRunning,
      latestTurnKey: "u1",
      lastMessageRole,
      now,
    });

  it("sums run times and leaves out the wait between runs", () => {
    const workTimes = new Map<string, WorkTime>();
    record(workTimes, true, 1000, "user");
    record(workTimes, true, 2000);
    record(workTimes, false, 4000);
    record(workTimes, false, 9000);
    record(workTimes, true, 10000);
    record(workTimes, false, 11500);
    expect(workTimes.get("u1")).toEqual({
      elapsedMs: 4500,
      workingSince: undefined,
    });
  });

  it("does not time a reply this client did not see start", () => {
    const workTimes = new Map<string, WorkTime>();
    record(workTimes, true, 1000, "assistant");
    expect(workTimes.size).toBe(0);
  });
});

describe("tool-call group helpers", () => {
  it.each([
    [result("a"), true, "done"],
    [result("a", "boom"), false, "failed"],
    [undefined, true, "running"],
    [undefined, false, "stopped"],
  ] as const)(
    "gives a row with result %o and active %s the status %s",
    (toolMessage, active, status) => {
      expect(getToolCallRowStatus(entry("a", "x", toolMessage), active)).toBe(
        status,
      );
    },
  );

  it("previews the first non-empty string argument with whitespace collapsed", () => {
    expect(
      getArgumentPreview({ count: 2, empty: " ", cmd: "ls \n  -la" }),
    ).toBe("ls -la");
    expect(getArgumentPreview({ count: 2 })).toBeUndefined();
    expect(getArgumentPreview("ls")).toBeUndefined();
  });

  it("previews arguments that are still streaming as partial JSON", () => {
    const streaming: ToolCallEntry = {
      toolCall: callMessage("a", "run", '{"path": "src/app.ts", "line')
        .toolCalls![0]!,
    };
    expect(getToolCallPreview(streaming)).toBe("src/app.ts");
  });

  it("names the tools used, counting repeats", () => {
    const calls = [entry("1", "run"), entry("2", "read"), entry("3", "run")];
    expect(formatToolNames(calls)).toBe("run ×2, read");
  });

  it("counts the failed calls", () => {
    const calls = [
      entry("1", "run", result("1", "boom")),
      entry("2", "run", result("2")),
      entry("3", "run"),
    ];
    expect(countFailedToolCalls(calls)).toBe(1);
  });

  it("picks the word that fits the count", () => {
    const words = { one: "tool", other: "tools" };
    expect([0, 1, 3].map((count) => pluralize(count, words))).toEqual([
      "0 tools",
      "1 tool",
      "3 tools",
    ]);
  });

  it("stringifies payloads, and falls back when JSON cannot encode them", () => {
    const circular: { self?: unknown } = {};
    circular.self = circular;
    const bare: { self?: unknown } = Object.create(null);
    bare.self = bare;

    expect(stringifyToolCallPayload("raw")).toBe("raw");
    expect(stringifyToolCallPayload({ a: 1 })).toBe('{\n  "a": 1\n}');
    expect(stringifyToolCallPayload(circular)).toBe("[object Object]");
    expect(stringifyToolCallPayload(bare)).toBe("[unserializable]");
  });
});

describe("durations", () => {
  it("formats work time as seconds, then minutes and seconds", () => {
    expect([-5, 1999, 45000, 65000, 120000].map(formatWorkDuration)).toEqual([
      "0s",
      "1s",
      "45s",
      "1m 5s",
      "2m",
    ]);
  });

  it("splits reasoning time into the unit a label renders", () => {
    expect([0.4, 12.6, 120, 65].map(formatReasoningDuration)).toEqual([
      { unit: "fewSeconds" },
      { unit: "seconds", seconds: 13 },
      { unit: "minutes", minutes: 2 },
      { unit: "minutesSeconds", minutes: 1, seconds: 5 },
    ]);
  });
});
