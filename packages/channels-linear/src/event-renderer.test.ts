import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EventType,
  HttpAgent,
  type AgentSubscriber,
  type ToolCallResultEvent,
} from "@ag-ui/client";
import type { CreateActivityOptions, LinearApiClient } from "./client.js";
import { createRunRenderer } from "./event-renderer.js";
import type { AgentActivityContent, ReplyTarget } from "./types.js";

const target: ReplyTarget = {
  organizationId: "org-1",
  agentSessionId: "sess-1",
  issueId: "issue-1",
};

interface PostedActivity {
  sessionId: string;
  content: AgentActivityContent;
  options: CreateActivityOptions;
}

/**
 * Fake Linear client. Records each activity when its post completes.
 * `delays[i]` makes the i-th post take that many ms; `failures` holds the
 * call indexes that throw.
 */
function fakeClient(setup: { delays?: number[]; failures?: number[] } = {}) {
  const posted: PostedActivity[] = [];
  let calls = 0;
  const client: Pick<LinearApiClient, "createActivity"> = {
    async createActivity(sessionId, content, options = {}) {
      const call = calls++;
      const delay = setup.delays?.[call] ?? 0;
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      if (setup.failures?.includes(call)) {
        throw new Error(`post ${call} failed`);
      }
      posted.push({ sessionId, content, options });
      return { id: `activity-${call}` };
    },
  };
  return { client, posted };
}

const agent = new HttpAgent({ url: "http://agent.test" });
const base = {
  messages: [],
  state: {},
  agent,
  input: {
    threadId: "thread-1",
    runId: "run-1",
    messages: [],
    tools: [],
    context: [],
    forwardedProps: {},
  },
};

/** Fire START and CONTENT for a text message; returns the END hook's promise. */
function textMessage(
  s: AgentSubscriber,
  messageId: string,
  ...deltas: string[]
) {
  s.onTextMessageStartEvent?.({
    ...base,
    event: { type: EventType.TEXT_MESSAGE_START, messageId, role: "assistant" },
  });
  let buffer = "";
  for (const delta of deltas) {
    buffer += delta;
    s.onTextMessageContentEvent?.({
      ...base,
      event: { type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta },
      textMessageBuffer: buffer,
    });
  }
  return s.onTextMessageEndEvent?.({
    ...base,
    event: { type: EventType.TEXT_MESSAGE_END, messageId },
    textMessageBuffer: buffer,
  });
}

/** Fire START and CONTENT for a reasoning message; returns the END hook's promise. */
function reasoningMessage(
  s: AgentSubscriber,
  messageId: string,
  ...deltas: string[]
) {
  s.onReasoningMessageStartEvent?.({
    ...base,
    event: {
      type: EventType.REASONING_MESSAGE_START,
      messageId,
      role: "reasoning",
    },
  });
  let buffer = "";
  for (const delta of deltas) {
    buffer += delta;
    s.onReasoningMessageContentEvent?.({
      ...base,
      event: { type: EventType.REASONING_MESSAGE_CONTENT, messageId, delta },
      reasoningMessageBuffer: buffer,
    });
  }
  return s.onReasoningMessageEndEvent?.({
    ...base,
    event: { type: EventType.REASONING_MESSAGE_END, messageId },
    reasoningMessageBuffer: buffer,
  });
}

/** Fire ARGS and END for a tool call; returns the END hook's promise. */
function toolCall(
  s: AgentSubscriber,
  toolCallId: string,
  toolCallName: string,
  toolCallArgs: Record<string, unknown>,
) {
  const json = JSON.stringify(toolCallArgs);
  s.onToolCallArgsEvent?.({
    ...base,
    event: { type: EventType.TOOL_CALL_ARGS, toolCallId, delta: json },
    toolCallBuffer: json,
    toolCallName,
    partialToolCallArgs: toolCallArgs,
  });
  return s.onToolCallEndEvent?.({
    ...base,
    event: { type: EventType.TOOL_CALL_END, toolCallId },
    toolCallName,
    toolCallArgs,
  });
}

function toolResult(
  s: AgentSubscriber,
  toolCallId: string,
  content: ToolCallResultEvent["content"],
) {
  return s.onToolCallResultEvent?.({
    ...base,
    event: {
      type: EventType.TOOL_CALL_RESULT,
      messageId: `result-${toolCallId}`,
      toolCallId,
      content,
    },
  });
}

function runError(s: AgentSubscriber, message: string) {
  return s.onRunErrorEvent?.({
    ...base,
    event: { type: EventType.RUN_ERROR, message },
  });
}

function customEvent(s: AgentSubscriber, name: string, value: unknown) {
  return s.onCustomEvent?.({
    ...base,
    event: { type: EventType.CUSTOM, name, value },
  });
}

function contents(posted: PostedActivity[]) {
  return posted.map((p) => p.content);
}

describe("createRunRenderer", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("posts one response activity per text message, to the target session", async () => {
    const { client, posted } = fakeClient();
    const r = createRunRenderer({ client, target });

    await textMessage(r.subscriber, "m1", "Hello ", "world");
    await textMessage(r.subscriber, "m2", "Second");
    await r.finish();

    expect(posted).toEqual([
      {
        sessionId: "sess-1",
        content: { type: "response", body: "Hello world" },
        options: {},
      },
      {
        sessionId: "sess-1",
        content: { type: "response", body: "Second" },
        options: {},
      },
    ]);
  });

  it("splits a text message longer than one activity body into several responses", async () => {
    const { client, posted } = fakeClient();
    const r = createRunRenderer({ client, target });

    await textMessage(r.subscriber, "m1", "a".repeat(50_000), "bbbbb");
    await r.finish();

    expect(contents(posted)).toEqual([
      { type: "response", body: "a".repeat(50_000) },
      { type: "response", body: "bbbbb" },
    ]);
  });

  it("cuts a long text message at the last newline that fits", async () => {
    const { client, posted } = fakeClient();
    const r = createRunRenderer({ client, target });

    await textMessage(
      r.subscriber,
      "m1",
      "x".repeat(49_990),
      "\n",
      "y".repeat(20),
    );
    await r.finish();

    expect(contents(posted)).toEqual([
      { type: "response", body: "x".repeat(49_990) },
      { type: "response", body: "y".repeat(20) },
    ]);
  });

  it("posts reasoning as one ephemeral thought and skips empty reasoning", async () => {
    const { client, posted } = fakeClient();
    const r = createRunRenderer({ client, target });

    await reasoningMessage(r.subscriber, "r1", "Reading ", "the issue");
    await reasoningMessage(r.subscriber, "r2", "  ");
    await r.finish();

    expect(posted).toEqual([
      {
        sessionId: "sess-1",
        content: { type: "thought", body: "Reading the issue" },
        options: { ephemeral: true },
      },
    ]);
  });

  it("posts an action when a tool call ends, then the action with its result", async () => {
    const { client, posted } = fakeClient();
    const r = createRunRenderer({ client, target });

    await toolCall(r.subscriber, "t1", "search_issues", { query: "login bug" });
    await toolResult(r.subscriber, "t1", "3 issues found");
    await r.finish();

    expect(posted).toEqual([
      {
        sessionId: "sess-1",
        content: {
          type: "action",
          action: "search_issues",
          parameter: '{"query":"login bug"}',
        },
        options: {},
      },
      {
        sessionId: "sess-1",
        content: {
          type: "action",
          action: "search_issues",
          parameter: '{"query":"login bug"}',
          result: "3 issues found",
        },
        options: {},
      },
    ]);
    expect(r.getCapturedToolCalls()).toEqual([
      {
        toolCallId: "t1",
        toolCallName: "search_issues",
        toolCallArgs: { query: "login bug" },
      },
    ]);
  });

  it("uses the text parts of a multi-part tool result and an empty parameter for no args", async () => {
    const { client, posted } = fakeClient();
    const r = createRunRenderer({ client, target });

    await toolCall(r.subscriber, "t1", "list_teams", {});
    await toolResult(r.subscriber, "t1", [
      { type: "text", text: "Core" },
      { type: "text", text: "Docs" },
    ]);
    await r.finish();

    expect(contents(posted)).toEqual([
      { type: "action", action: "list_teams", parameter: "" },
      {
        type: "action",
        action: "list_teams",
        parameter: "",
        result: "Core\nDocs",
      },
    ]);
  });

  it("ignores a tool result for a tool call it did not see", async () => {
    const { client, posted } = fakeClient();
    const r = createRunRenderer({ client, target });

    await toolResult(r.subscriber, "unknown", "orphan");
    await r.finish();

    expect(posted).toEqual([]);
  });

  it("posts a run error as an error activity", async () => {
    const { client, posted } = fakeClient();
    const r = createRunRenderer({ client, target });

    await runError(r.subscriber, "model overloaded");
    await r.finish();

    expect(contents(posted)).toEqual([
      { type: "error", body: "model overloaded" },
    ]);
  });

  it("posts activities in event order when an earlier post is slower", async () => {
    const { client, posted } = fakeClient({ delays: [30, 0, 0] });
    const r = createRunRenderer({ client, target });

    void reasoningMessage(r.subscriber, "r1", "Thinking");
    void toolCall(r.subscriber, "t1", "lookup", { id: 7 });
    void textMessage(r.subscriber, "m1", "Done");
    await r.finish();

    expect(contents(posted).map((c) => c.type)).toEqual([
      "thought",
      "action",
      "response",
    ]);
  });

  it("keeps posting after a failed post and exposes the first failure", async () => {
    const { client, posted } = fakeClient({ failures: [0, 1] });
    const r = createRunRenderer({ client, target });

    await textMessage(r.subscriber, "m1", "lost");
    await textMessage(r.subscriber, "m2", "lost too");
    await textMessage(r.subscriber, "m3", "kept");
    await r.finish();

    expect(contents(posted)).toEqual([{ type: "response", body: "kept" }]);
    expect(r.getDeliveryError()).toEqual(new Error("post 0 failed"));
  });

  it("captures an interrupt from a matching custom event and parses a JSON string value", () => {
    const { client } = fakeClient();
    const r = createRunRenderer({ client, target });

    customEvent(r.subscriber, "progress", { step: 1 });
    expect(r.getPendingInterrupt()).toBeUndefined();

    customEvent(r.subscriber, "on_interrupt", '{"question":"Ship it?"}');
    expect(r.getPendingInterrupt()).toEqual({
      eventName: "on_interrupt",
      value: { question: "Ship it?" },
    });

    r.clearPendingInterrupt();
    expect(r.getPendingInterrupt()).toBeUndefined();
  });

  it("captures interrupts under custom event names", () => {
    const { client } = fakeClient();
    const r = createRunRenderer({
      client,
      target,
      interruptEventNames: new Set(["ask_user"]),
    });

    customEvent(r.subscriber, "on_interrupt", { ignored: true });
    customEvent(r.subscriber, "ask_user", "not json");

    expect(r.getPendingInterrupt()).toEqual({
      eventName: "ask_user",
      value: "not json",
    });
  });

  it("posts nothing after markInterrupted, dropping queued activities", async () => {
    const { client, posted } = fakeClient({ delays: [30] });
    const r = createRunRenderer({ client, target });

    void textMessage(r.subscriber, "m1", "in flight");
    await Promise.resolve();
    void textMessage(r.subscriber, "m2", "queued");
    await r.markInterrupted();

    await textMessage(r.subscriber, "m3", "late");
    await toolCall(r.subscriber, "t1", "late_tool", {});
    await runError(r.subscriber, "late error");
    await r.finish();

    expect(contents(posted)).toEqual([{ type: "response", body: "in flight" }]);
  });
});
