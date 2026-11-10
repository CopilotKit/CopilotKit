import { EventType } from "@ag-ui/client";
import type { AgentSubscriber, RunAgentInput } from "@ag-ui/client";
import { FakeAgent } from "@copilotkit/channels-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StaticTokenProvider } from "./app-auth.js";
import { BOT_MARKER_LENGTH, hasBotMarker } from "./bot-marker.js";
import { GitHubApiClient } from "./client.js";
import type { GitHubCommentRef } from "./client.js";
import { createRunRenderer } from "./event-renderer.js";
import type { GitHubRunRendererOptions } from "./event-renderer.js";
import { GITHUB_LIMITS } from "./render/budget.js";
import type { GitHubComment, ReplyTarget } from "./types.js";

/** A request body with the hidden bot marker removed from its `body` text. */
function withoutMarker<T extends { body?: string }>(payload: T): T {
  if (payload.body === undefined || !hasBotMarker(payload.body)) {
    return payload;
  }
  return { ...payload, body: payload.body.slice(0, -BOT_MARKER_LENGTH) };
}

const API = "https://api.github.test";
const ISSUE_TARGET: ReplyTarget = {
  owner: "acme",
  repo: "widgets",
  issueNumber: 7,
};
const REVIEW_TARGET: ReplyTarget = { ...ISSUE_TARGET, reviewCommentId: 55 };
const TRIGGER: GitHubCommentRef = { kind: "issue", commentId: 42 };
const REACTION_ID = 900;

interface RecordedRequest {
  method: string;
  path: string;
  body?: { body?: string; content?: string };
}

/** Answers a request with an error response, or `undefined` to let the fake GitHub handle it. */
type FailureHook = (request: RecordedRequest) => Response | undefined;

/**
 * In-memory GitHub behind a fake `fetch`. Records every request and keeps the
 * current body of each comment, so tests can read what a reader would see.
 */
function createFakeGitHub() {
  const requests: RecordedRequest[] = [];
  const bodies = new Map<number, string>();
  let nextId = 100;
  let fail: FailureHook = () => undefined;

  const comment = (id: number, body: string): GitHubComment => ({
    id,
    body,
    user: { login: "ck-bot[bot]", id: 1, type: "Bot" },
    html_url: `https://github.test/acme/widgets/issues/7#issuecomment-${id}`,
    created_at: "2026-11-10T10:00:00Z",
  });

  const fetchImpl: typeof fetch = async (input, init) => {
    const request: RecordedRequest = {
      method: init?.method ?? "GET",
      path: new URL(String(input)).pathname,
      // Record the text the code under test wrote, without the client's marker.
      body:
        typeof init?.body === "string"
          ? withoutMarker(JSON.parse(init.body))
          : undefined,
    };
    requests.push(request);
    const failure = fail(request);
    if (failure !== undefined) return failure;

    const text = request.body?.body ?? "";
    const isCreate =
      request.method === "POST" && /\/(comments|replies)$/.test(request.path);
    if (isCreate) {
      const id = nextId++;
      bodies.set(id, text);
      return Response.json(comment(id, text), { status: 201 });
    }
    if (request.method === "POST" && request.path.endsWith("/reactions")) {
      return Response.json({ id: REACTION_ID }, { status: 201 });
    }
    if (request.method === "PATCH") {
      const id = Number(request.path.split("/").at(-1));
      bodies.set(id, text);
      return Response.json(comment(id, text));
    }
    return new Response(null, { status: 204 });
  };

  const client = new GitHubApiClient({
    auth: new StaticTokenProvider("ghp_test"),
    apiBaseUrl: API,
    fetch: fetchImpl,
  });

  return {
    client,
    requests,
    /** Current comment bodies, in creation order. */
    commentBodies: () => Array.from(bodies.values()),
    failWith(hook: FailureHook) {
      fail = hook;
    },
  };
}

function createRenderer(
  github: ReturnType<typeof createFakeGitHub>,
  options: Partial<GitHubRunRendererOptions> = {},
) {
  return createRunRenderer({
    client: github.client,
    target: ISSUE_TARGET,
    ...options,
  });
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

/** Drives AG-UI events into a subscriber the way `@ag-ui/client` calls it. */
function createEmitter(subscriber: AgentSubscriber) {
  const params = {
    messages: [],
    state: {},
    agent: new FakeAgent(),
    input: RUN_INPUT,
  };
  return {
    start: (messageId: string) =>
      subscriber.onTextMessageStartEvent?.({
        ...params,
        event: { type: EventType.TEXT_MESSAGE_START, messageId },
      }),
    delta: (messageId: string, delta: string) =>
      subscriber.onTextMessageContentEvent?.({
        ...params,
        event: { type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta },
        textMessageBuffer: "",
      }),
    end: (messageId: string) =>
      subscriber.onTextMessageEndEvent?.({
        ...params,
        event: { type: EventType.TEXT_MESSAGE_END, messageId },
        textMessageBuffer: "",
      }),
    toolArgs: (toolCallId: string, args: Record<string, unknown>) =>
      subscriber.onToolCallArgsEvent?.({
        ...params,
        event: { type: EventType.TOOL_CALL_ARGS, toolCallId, delta: "" },
        toolCallBuffer: "",
        toolCallName: "search",
        partialToolCallArgs: args,
      }),
    toolEnd: (toolCallId: string, args: Record<string, unknown>) =>
      subscriber.onToolCallEndEvent?.({
        ...params,
        event: { type: EventType.TOOL_CALL_END, toolCallId },
        toolCallName: "search",
        toolCallArgs: args,
      }),
    custom: (name: string, value: unknown) =>
      subscriber.onCustomEvent?.({
        ...params,
        event: { type: EventType.CUSTOM, name, value },
      }),
    runError: (message: string) =>
      subscriber.onRunErrorEvent?.({
        ...params,
        event: { type: EventType.RUN_ERROR, message },
      }),
  };
}

/** Let queued client calls and due throttle timers run. */
async function advance(ms = 0) {
  await vi.advanceTimersByTimeAsync(ms);
}

function writes(github: ReturnType<typeof createFakeGitHub>) {
  return github.requests
    .filter((request) => request.method !== "GET")
    .map((request) => `${request.method} ${request.path}`);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("createRunRenderer text streaming", () => {
  it("creates the comment on the first delta, edits at most once per throttle window, and writes the final text on END", async () => {
    const github = createFakeGitHub();
    const emit = createEmitter(createRenderer(github).subscriber);

    await emit.start("m1");
    await emit.delta("m1", "Hello");
    await advance();
    expect(github.requests.map((r) => [r.method, r.body?.body])).toEqual([
      ["POST", "Hello"],
    ]);

    await emit.delta("m1", " wor");
    await emit.delta("m1", "ld");
    await advance(500);
    expect(github.requests).toHaveLength(1);

    await advance(500);
    expect(github.requests.map((r) => [r.method, r.body?.body])).toEqual([
      ["POST", "Hello"],
      ["PATCH", "Hello world"],
    ]);

    await emit.delta("m1", "!");
    await emit.end("m1");
    expect(github.commentBodies()).toEqual(["Hello world!"]);
    expect(writes(github)).toEqual([
      "POST /repos/acme/widgets/issues/7/comments",
      "PATCH /repos/acme/widgets/issues/comments/100",
      "PATCH /repos/acme/widgets/issues/comments/100",
    ]);
  });

  it("posts each text message as its own comment", async () => {
    const github = createFakeGitHub();
    const emit = createEmitter(createRenderer(github).subscriber);

    await emit.start("m1");
    await emit.delta("m1", "First");
    await emit.end("m1");
    await emit.start("m2");
    await emit.delta("m2", "Second");
    await emit.end("m2");

    expect(github.commentBodies()).toEqual(["First", "Second"]);
  });

  it("replies inside the review thread when the target has a reviewCommentId", async () => {
    const github = createFakeGitHub();
    const renderer = createRenderer(github, {
      target: { ...REVIEW_TARGET, installationId: 51234567 },
    });
    const emit = createEmitter(renderer.subscriber);

    await emit.start("m1");
    await emit.delta("m1", "Looks");
    await advance();
    await emit.delta("m1", " good");
    await emit.end("m1");

    expect(writes(github)).toEqual([
      "POST /repos/acme/widgets/pulls/7/comments/55/replies",
      "PATCH /repos/acme/widgets/pulls/comments/100",
    ]);
    expect(github.commentBodies()).toEqual(["Looks good"]);
    // The ref keeps the review thread, so update/delete find the comment and
    // its pending-choice key again.
    expect(renderer.getPostedRefs()).toEqual([
      {
        id: 100,
        kind: "review",
        owner: "acme",
        repo: "widgets",
        issueNumber: 7,
        installationId: 51234567,
        reviewCommentId: 55,
      },
    ]);
  });

  it("continues past the comment limit in a new comment with the code fence closed and re-opened", async () => {
    const github = createFakeGitHub();
    const emit = createEmitter(createRenderer(github).subscriber);
    const codeLine = `${"x".repeat(99)}\n`;
    const text = `Intro\n\`\`\`ts\n${codeLine.repeat(700)}\`\`\`\nDone`;

    await emit.start("m1");
    await emit.delta("m1", text);
    await emit.end("m1");

    const bodies = github.commentBodies();
    expect(bodies).toHaveLength(2);
    const [first = "", second = ""] = bodies;
    expect(first.length).toBeLessThanOrEqual(GITHUB_LIMITS.commentBody);
    expect(first.startsWith("Intro\n```ts\n")).toBe(true);
    expect(first.endsWith("\n```")).toBe(true);
    expect(second.startsWith("```ts\n")).toBe(true);
    expect(second.endsWith("```\nDone")).toBe(true);
    const rejoined =
      first.slice(0, -"\n```".length) + second.slice("```ts\n".length);
    expect(rejoined).toBe(text);
  });

  it("sends the newest text when the run finishes before END", async () => {
    const github = createFakeGitHub();
    const renderer = createRenderer(github);
    const emit = createEmitter(renderer.subscriber);

    await emit.start("m1");
    await emit.delta("m1", "Hel");
    await advance();
    await emit.delta("m1", "lo");
    await renderer.finish();

    expect(github.commentBodies()).toEqual(["Hello"]);
  });
});

describe("createRunRenderer eyes reaction", () => {
  it("adds eyes to the trigger comment once at the first text message and removes it on finish", async () => {
    const github = createFakeGitHub();
    const renderer = createRenderer(github, { triggerCommentRef: TRIGGER });
    const emit = createEmitter(renderer.subscriber);

    await emit.start("m1");
    await emit.end("m1");
    await emit.start("m2");
    await advance();
    expect(github.requests.map((r) => [r.method, r.path, r.body])).toEqual([
      [
        "POST",
        "/repos/acme/widgets/issues/comments/42/reactions",
        { content: "eyes" },
      ],
    ]);

    await renderer.finish();
    expect(writes(github)).toEqual([
      "POST /repos/acme/widgets/issues/comments/42/reactions",
      `DELETE /repos/acme/widgets/issues/comments/42/reactions/${REACTION_ID}`,
    ]);
  });

  it("keeps streaming when adding the reaction fails", async () => {
    const github = createFakeGitHub();
    github.failWith((request) =>
      request.path.endsWith("/reactions")
        ? new Response("nope", { status: 500 })
        : undefined,
    );
    const renderer = createRenderer(github, { triggerCommentRef: TRIGGER });
    const emit = createEmitter(renderer.subscriber);

    await emit.start("m1");
    await emit.delta("m1", "Hi");
    await emit.end("m1");
    await renderer.finish();

    expect(github.commentBodies()).toEqual(["Hi"]);
    expect(writes(github)).not.toContain(
      `DELETE /repos/acme/widgets/issues/comments/42/reactions/${REACTION_ID}`,
    );
  });
});

describe("createRunRenderer capture", () => {
  it("captures tool calls, keeping the latest args per tool call id", async () => {
    const github = createFakeGitHub();
    const renderer = createRenderer(github);
    const emit = createEmitter(renderer.subscriber);

    await emit.toolArgs("t1", { q: "par" });
    await emit.toolEnd("t1", { q: "parser" });
    await emit.toolEnd("t2", {});

    expect(renderer.getCapturedToolCalls()).toEqual([
      {
        toolCallId: "t1",
        toolCallName: "search",
        toolCallArgs: { q: "parser" },
      },
      { toolCallId: "t2", toolCallName: "search", toolCallArgs: {} },
    ]);
  });

  it("captures an interrupt custom event, parsing a JSON string value, and ignores other names", async () => {
    const github = createFakeGitHub();
    const renderer = createRenderer(github);
    const emit = createEmitter(renderer.subscriber);

    await emit.custom("progress", { pct: 50 });
    expect(renderer.getPendingInterrupt()).toBeUndefined();

    await emit.custom("on_interrupt", '{"question":"Ship it?"}');
    expect(renderer.getPendingInterrupt()).toEqual({
      eventName: "on_interrupt",
      value: { question: "Ship it?" },
    });

    renderer.clearPendingInterrupt();
    expect(renderer.getPendingInterrupt()).toBeUndefined();
  });

  it("uses custom interrupt event names when given", async () => {
    const github = createFakeGitHub();
    const renderer = createRenderer(github, {
      interruptEventNames: new Set(["ask_user"]),
    });
    const emit = createEmitter(renderer.subscriber);

    await emit.custom("on_interrupt", "ignored");
    await emit.custom("ask_user", "plain text");

    expect(renderer.getPendingInterrupt()).toEqual({
      eventName: "ask_user",
      value: "plain text",
    });
  });
});

describe("createRunRenderer interruption and errors", () => {
  it("markInterrupted writes the buffered text with an interrupted suffix and stops further edits", async () => {
    const github = createFakeGitHub();
    const renderer = createRenderer(github, { triggerCommentRef: TRIGGER });
    const emit = createEmitter(renderer.subscriber);

    await emit.start("m1");
    await emit.delta("m1", "Partial");
    await advance();
    await emit.delta("m1", " answer");
    await renderer.markInterrupted();
    expect(github.commentBodies()).toEqual([
      "Partial answer\n\n_(interrupted)_",
    ]);
    const requestCount = github.requests.length;

    await emit.delta("m1", " more");
    await emit.end("m1");
    await renderer.finish();
    await advance(5000);

    expect(github.requests).toHaveLength(requestCount);
    expect(writes(github)).toContain(
      `DELETE /repos/acme/widgets/issues/comments/42/reactions/${REACTION_ID}`,
    );
  });

  it("posts the agent error as a comment on RUN_ERROR", async () => {
    const github = createFakeGitHub();
    const emit = createEmitter(createRenderer(github).subscriber);

    await emit.runError("model overloaded");

    expect(github.commentBodies()).toEqual([
      "⚠️ Agent error: model overloaded",
    ]);
  });

  it("does not throw when an edit is rate limited, and retries after retryAfterMs", async () => {
    const github = createFakeGitHub();
    let rateLimited = true;
    github.failWith((request) => {
      if (request.method !== "PATCH" || !rateLimited) return undefined;
      rateLimited = false;
      return new Response("slow down", {
        status: 429,
        headers: { "retry-after": "2" },
      });
    });
    const emit = createEmitter(createRenderer(github).subscriber);

    await emit.start("m1");
    await emit.delta("m1", "One");
    await advance();
    await emit.delta("m1", " two");
    await expect(emit.end("m1")).resolves.toBeUndefined();
    expect(github.commentBodies()).toEqual(["One"]);

    await advance(2000);
    expect(github.commentBodies()).toEqual(["One two"]);
  });

  it("does not throw when creating the comment fails", async () => {
    const github = createFakeGitHub();
    github.failWith(() => new Response("boom", { status: 500 }));
    const emit = createEmitter(createRenderer(github).subscriber);

    await emit.start("m1");
    await emit.delta("m1", "Hi");
    await expect(emit.end("m1")).resolves.toBeUndefined();
    expect(github.commentBodies()).toEqual([]);
  });

  it("finish rejects with the error when the final write fails, and logs it once", async () => {
    const github = createFakeGitHub();
    const renderer = createRenderer(github);
    const emit = createEmitter(renderer.subscriber);

    await emit.start("m1");
    await emit.delta("m1", "One");
    await advance();
    github.failWith((request) =>
      request.method === "PATCH"
        ? new Response("boom", { status: 500 })
        : undefined,
    );
    await emit.delta("m1", " two");
    await expect(emit.end("m1")).resolves.toBeUndefined();

    await expect(renderer.finish()).rejects.toMatchObject({
      name: "GitHubApiError",
      status: 500,
      method: "PATCH",
    });
    expect(github.commentBodies()).toEqual(["One"]);
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("finish resolves when the final write succeeds after an earlier edit failed", async () => {
    const github = createFakeGitHub();
    let failNextEdit = true;
    github.failWith((request) => {
      if (request.method !== "PATCH" || !failNextEdit) return undefined;
      failNextEdit = false;
      return new Response("boom", { status: 500 });
    });
    const renderer = createRenderer(github);
    const emit = createEmitter(renderer.subscriber);

    await emit.start("m1");
    await emit.delta("m1", "One");
    await advance();
    await emit.delta("m1", " two");
    await advance(1000);
    await emit.delta("m1", "!");
    await emit.end("m1");

    await expect(renderer.finish()).resolves.toBeUndefined();
    expect(github.commentBodies()).toEqual(["One two!"]);
  });
});
