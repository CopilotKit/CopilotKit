import { EventType, HttpAgent } from "@ag-ui/client";
import type { RunAgentInput } from "@ag-ui/client";
import type { RunRenderer } from "@copilotkit/channels-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotionApiError } from "./client.js";
import { createRunRenderer } from "./event-renderer.js";
import { richTextToPlainText } from "./render/rich-text.js";
import type { NotionComment, ReplyTarget, RichTextItem } from "./types.js";

const TARGET: ReplyTarget = { pageId: "page-1", discussionId: "disc-1" };

interface StoredComment {
  id: string;
  discussionId: string;
  richText: RichTextItem[];
}

/** Fake Notion comments API: keeps the comments and logs each call. */
function createFakeNotion() {
  const comments = new Map<string, StoredComment>();
  const calls: string[] = [];
  const updateFailures: Error[] = [];
  let createGate: Promise<void> = Promise.resolve();

  const toNotionComment = (stored: StoredComment) => {
    const comment: NotionComment = {
      id: stored.id,
      discussion_id: stored.discussionId,
      parent: { type: "page_id", page_id: TARGET.pageId },
      created_by: { object: "user", id: "bot-1" },
      created_time: "2026-11-10T00:00:00.000Z",
      rich_text: stored.richText,
    };
    return comment;
  };

  const client = {
    async createComment(reply: {
      discussionId: string;
      richText: RichTextItem[];
    }) {
      await createGate;
      const stored = { id: `c${comments.size + 1}`, ...reply };
      comments.set(stored.id, stored);
      calls.push(`create ${stored.id}`);
      return toNotionComment(stored);
    },
    async updateComment(commentId: string, richText: RichTextItem[]) {
      const failure = updateFailures.shift();
      if (failure) throw failure;
      const stored = comments.get(commentId);
      if (!stored) throw new Error(`no comment ${commentId}`);
      stored.richText = richText;
      calls.push(`update ${commentId}`);
      return toNotionComment(stored);
    },
  };

  return {
    client,
    calls,
    /** Plain text of every comment, in creation order. */
    texts: () =>
      Array.from(comments.values(), (c) => richTextToPlainText(c.richText)),
    comment: (id: string) => comments.get(id),
    failNextUpdate: (err: Error) => updateFailures.push(err),
    /** Hold every createComment until the returned function is called. */
    holdCreates: () => {
      let release = () => {};
      createGate = new Promise<void>((resolve) => {
        release = resolve;
      });
      return release;
    },
  };
}

const RUN_INPUT: RunAgentInput = {
  threadId: "thread-1",
  runId: "run-1",
  state: {},
  messages: [],
  tools: [],
  context: [],
  forwardedProps: {},
};

/** Typed AG-UI event driver for a renderer's subscriber. */
function driver(renderer: RunRenderer) {
  const s = renderer.subscriber;
  const base = {
    messages: [],
    state: {},
    agent: new HttpAgent({ url: "http://agent.test" }),
    input: RUN_INPUT,
  };
  return {
    start: (messageId: string) =>
      s.onTextMessageStartEvent?.({
        ...base,
        event: {
          type: EventType.TEXT_MESSAGE_START,
          messageId,
          role: "assistant",
        },
      }),
    delta: (messageId: string, delta: string) =>
      s.onTextMessageContentEvent?.({
        ...base,
        event: { type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta },
        textMessageBuffer: "",
      }),
    end: (messageId: string) =>
      s.onTextMessageEndEvent?.({
        ...base,
        event: { type: EventType.TEXT_MESSAGE_END, messageId },
        textMessageBuffer: "",
      }),
    toolArgs: (
      toolCallId: string,
      name: string,
      args: Record<string, unknown>,
    ) =>
      s.onToolCallArgsEvent?.({
        ...base,
        event: { type: EventType.TOOL_CALL_ARGS, toolCallId, delta: "" },
        toolCallBuffer: "",
        toolCallName: name,
        partialToolCallArgs: args,
      }),
    toolEnd: (
      toolCallId: string,
      name: string,
      args: Record<string, unknown>,
    ) =>
      s.onToolCallEndEvent?.({
        ...base,
        event: { type: EventType.TOOL_CALL_END, toolCallId },
        toolCallName: name,
        toolCallArgs: args,
      }),
    custom: (name: string, value: unknown) =>
      s.onCustomEvent?.({
        ...base,
        event: { type: EventType.CUSTOM, name, value },
      }),
    runError: (message: string) =>
      s.onRunErrorEvent?.({
        ...base,
        event: { type: EventType.RUN_ERROR, message },
      }),
  };
}

function setup(
  options: {
    throttleMs?: number;
    interruptEventNames?: ReadonlySet<string>;
  } = {},
) {
  const notion = createFakeNotion();
  const onFirstReply = vi.fn();
  const renderer = createRunRenderer({
    client: notion.client,
    target: TARGET,
    onFirstReply,
    ...options,
  });
  return { notion, onFirstReply, renderer, run: driver(renderer) };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("createRunRenderer text streaming", () => {
  it("creates the comment on the first delta and calls onFirstReply once per run", async () => {
    const { notion, onFirstReply, renderer, run } = setup();
    run.start("m1");
    run.delta("m1", "Hello");
    await vi.advanceTimersByTimeAsync(0);
    expect(notion.calls).toEqual(["create c1"]);
    expect(notion.texts()).toEqual(["Hello"]);
    await run.end("m1");
    run.delta("m2", "Second");
    await run.end("m2");
    await renderer.finish?.();

    expect(notion.texts()).toEqual(["Hello", "Second"]);
    expect(onFirstReply).toHaveBeenCalledTimes(1);
  });

  it("edits the comment at most once per throttle window", async () => {
    const { notion, run } = setup({ throttleMs: 1000 });
    run.delta("m1", "a");
    await vi.advanceTimersByTimeAsync(0);
    run.delta("m1", "b");
    run.delta("m1", "c");
    await vi.advanceTimersByTimeAsync(999);
    expect(notion.calls).toEqual(["create c1"]);

    await vi.advanceTimersByTimeAsync(1);
    expect(notion.calls).toEqual(["create c1", "update c1"]);
    expect(notion.texts()).toEqual(["abc"]);
  });

  it("writes the final text on TEXT_MESSAGE_END without waiting for the throttle", async () => {
    const { notion, run } = setup();
    run.delta("m1", "Hel");
    await vi.advanceTimersByTimeAsync(0);
    run.delta("m1", "lo **world**");
    await run.end("m1");

    expect(notion.texts()).toEqual(["Hello world"]);
    expect(notion.comment("c1")?.richText.at(-1)).toEqual({
      type: "text",
      text: { content: "world" },
      annotations: { bold: true },
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(notion.calls).toEqual(["create c1", "update c1"]);
  });

  it("updates, not re-creates, when deltas arrive while the create is in flight", async () => {
    const { notion, run } = setup();
    const releaseCreate = notion.holdCreates();
    run.delta("m1", "one ");
    await vi.advanceTimersByTimeAsync(0);
    run.delta("m1", "two");
    const ended = run.end("m1");
    releaseCreate();
    await ended;

    expect(notion.calls).toEqual(["create c1", "update c1"]);
    expect(notion.texts()).toEqual(["one two"]);
  });

  it("folds deltas that arrive before the create runs into that create", async () => {
    const { notion, run } = setup();
    run.delta("m1", "one ");
    run.delta("m1", "two");
    await run.end("m1");

    expect(notion.calls).toEqual(["create c1"]);
    expect(notion.texts()).toEqual(["one two"]);
  });

  it("continues in a new comment when the text passes the comment limit", async () => {
    const { notion, run } = setup();
    const line = `${"x".repeat(99)}\n`;
    run.delta("m1", line.repeat(100));
    run.delta("m1", line.repeat(70));
    await run.end("m1");

    expect(notion.texts()).toEqual([line.repeat(160), line.repeat(10)]);
  });

  it("does not throw when an update is rate limited, and finish() sends the text", async () => {
    const { notion, renderer, run } = setup();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    run.delta("m1", "Hello");
    await vi.advanceTimersByTimeAsync(0);
    notion.failNextUpdate(
      new NotionApiError({
        status: 429,
        code: "rate_limited",
        message: "slow down",
        retryAfterMs: 30_000,
      }),
    );
    run.delta("m1", " world");
    await expect(run.end("m1")).resolves.toBeUndefined();
    expect(notion.texts()).toEqual(["Hello"]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("[channels-notion] rate limited"),
    );

    await renderer.finish?.();
    expect(notion.texts()).toEqual(["Hello world"]);
  });

  it("posts a comment for RUN_ERROR", async () => {
    const { notion, run } = setup();
    await run.runError("boom");
    expect(notion.texts()).toEqual(["⚠️ Agent error: boom"]);
  });
});

describe("createRunRenderer markInterrupted", () => {
  it("adds an italic (interrupted) suffix and ignores later events", async () => {
    const { notion, renderer, run } = setup();
    run.delta("m1", "Hello");
    await vi.advanceTimersByTimeAsync(0);
    await renderer.markInterrupted();
    run.delta("m1", " more");
    await run.end("m1");
    await vi.advanceTimersByTimeAsync(5000);

    expect(notion.texts()).toEqual(["Hello\n(interrupted)"]);
    expect(notion.comment("c1")?.richText.at(-1)).toEqual({
      type: "text",
      text: { content: "(interrupted)" },
      annotations: { italic: true },
    });
  });
});

describe("createRunRenderer capture", () => {
  it("keeps the latest args of each tool call", () => {
    const { renderer, run } = setup();
    run.toolArgs("t1", "search", { q: "no" });
    run.toolEnd("t1", "search", { q: "notion" });
    run.toolEnd("t2", "open", { id: 7 });

    expect(renderer.getCapturedToolCalls()).toEqual([
      {
        toolCallId: "t1",
        toolCallName: "search",
        toolCallArgs: { q: "notion" },
      },
      { toolCallId: "t2", toolCallName: "open", toolCallArgs: { id: 7 } },
    ]);
  });

  it("captures on_interrupt and parses a JSON string value", () => {
    const { renderer, run } = setup();
    run.custom("progress", { step: 1 });
    expect(renderer.getPendingInterrupt()).toBeUndefined();

    run.custom("on_interrupt", '{"question":"Ship it?"}');
    expect(renderer.getPendingInterrupt()).toEqual({
      eventName: "on_interrupt",
      value: { question: "Ship it?" },
    });

    renderer.clearPendingInterrupt();
    expect(renderer.getPendingInterrupt()).toBeUndefined();
  });

  it("uses custom interrupt event names", () => {
    const { renderer, run } = setup({
      interruptEventNames: new Set(["ask_user"]),
    });
    run.custom("on_interrupt", "ignored");
    run.custom("ask_user", "not json");

    expect(renderer.getPendingInterrupt()).toEqual({
      eventName: "ask_user",
      value: "not json",
    });
  });
});
