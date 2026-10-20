import { expect, test, vi } from "vitest";
import { EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import { MockSocket } from "./test-utils";

vi.mock("phoenix", () => ({ Socket: MockSocket }));

const { IntelligenceAgent } = await import("../intelligence-agent");
const { AgentHistoryReplayError, ProxiedCopilotRuntimeAgent, CopilotKitCore } =
  await import("../index");

class ReplayAgent extends IntelligenceAgent {
  replay(input: RunAgentInput) {
    return this.connect(input);
  }
}

function setup() {
  const input: RunAgentInput = {
    threadId: "thread-1",
    runId: "run-1",
    messages: [],
    tools: [],
    context: [],
    state: {},
    forwardedProps: {},
  };
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          threadId: input.threadId,
          runId: input.runId,
          joinToken: "join-token",
          realtime: {
            clientUrl: "ws://localhost:4000/client",
            topic: `thread:${input.threadId}`,
          },
        }),
        { headers: { "content-type": "application/json" } },
      ),
  );
  vi.stubGlobal("fetch", fetch);
  const channels = vi.spyOn(MockSocket.prototype, "channel");
  const disconnect = vi.spyOn(MockSocket.prototype, "disconnect");
  const agent = new ReplayAgent({
    url: "ws://localhost:4000/client",
    runtimeUrl: "http://localhost:4000",
    agentId: "agent-1",
  });
  const teardown = () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  };
  return { agent, channels, disconnect, fetch, input, teardown };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

test.each(["backoff", "credentials", "restore"] as const)(
  "congestion budget expires while awaiting %s and keeps the safe checkpoint",
  async (phase) => {
    const { agent, channels, fetch, input, teardown } = setup();
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const failure = vi.fn();
    const pendingCredentials = deferred<Response>();
    const subscription = agent.replay(input).subscribe({ error: failure });
    try {
      await vi.advanceTimersByTimeAsync(0);
      const first = channels.mock.results[0]!.value;
      first.triggerJoin("ok");
      first.serverPush("replay_failed", {
        reason: "history_busy",
        retryable: true,
        latestEventId: "safe-checkpoint",
      });
      if (phase === "credentials")
        fetch.mockReturnValueOnce(pendingCredentials.promise);

      let elapsed = 750;
      await vi.advanceTimersByTimeAsync(elapsed);
      if (phase !== "credentials") {
        channels.mock.results[1]!.value.triggerJoin("ok");
      }
      if (phase === "backoff") {
        for (let attempt = 1; elapsed < 300_000; attempt++) {
          channels.mock.results[attempt]!.value.serverPush("replay_failed", {
            reason: "history_busy",
            retryable: true,
            latestEventId: "safe-checkpoint",
          });
          const delay = Math.min(1_000 * 2 ** attempt, 30_000) * 0.75;
          if (elapsed + delay >= 300_000) break;
          await vi.advanceTimersByTimeAsync(delay);
          elapsed += delay;
          channels.mock.results[attempt + 1]!.value.triggerJoin("ok");
        }
      }
      await vi.advanceTimersByTimeAsync(300_000 - elapsed - 1);
      expect(failure).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);

      expect(failure).toHaveBeenCalledExactlyOnceWith(
        new AgentHistoryReplayError("history_busy"),
      );
      expect(subscription.closed).toBe(true);
      expect(channels.mock.results.at(-1)!.value.left).toBe(true);
      if (phase === "credentials") {
        expect(fetch.mock.calls[1]![1]?.signal?.aborted).toBe(true);
      }
      const requestsAtFailure = fetch.mock.calls.length;
      await vi.advanceTimersByTimeAsync(60_000);
      expect(fetch).toHaveBeenCalledTimes(requestsAtFailure);
      const explicitRetry = agent.replay(input).subscribe({ error: failure });
      try {
        await vi.advanceTimersByTimeAsync(0);
        expect(
          JSON.parse(String(fetch.mock.calls.at(-1)![1]?.body)),
        ).toMatchObject({
          lastSeenEventId: "safe-checkpoint",
        });
      } finally {
        explicitRetry.unsubscribe();
      }
    } finally {
      subscription.unsubscribe();
      teardown();
    }
  },
);

test.each(["connect", "run"] as const)(
  "%s exposes permanent replay failure and closes the transport",
  async (mode) => {
    const { agent, channels, disconnect, input, teardown } = setup();
    const error = vi.fn();
    const next = vi.fn();
    const complete = vi.fn();
    const stream = mode === "connect" ? agent.replay(input) : agent.run(input);
    const subscription = stream.subscribe({ error, next, complete });
    try {
      await vi.waitFor(() => expect(channels).toHaveBeenCalledOnce());
      const channel = channels.mock.results[0]!.value;
      expect(channel.params.supports_replay_errors).toBe(
        mode === "connect" ? true : undefined,
      );
      channel.triggerJoin("ok");

      channel.serverPush("replay_failed", {
        reason: "history_event_too_large",
        retryable: false,
        latestEventId: null,
      });

      expect(error).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "AgentHistoryReplayError",
          reason: "history_event_too_large",
          message: "Thread history replay failed: history_event_too_large",
        }),
      );
      expect(error.mock.calls[0]![0]).toBeInstanceOf(AgentHistoryReplayError);
      expect(next).not.toHaveBeenCalled();
      expect(complete).not.toHaveBeenCalled();
      expect(subscription.closed).toBe(true);
      expect(channel.left).toBe(true);
      expect(disconnect).toHaveBeenCalled();
    } finally {
      subscription.unsubscribe();
      teardown();
    }
  },
);

test.each(["delivered-event", null])(
  "a terminal replay failure preserves delivered checkpoint %s for the next explicit connect",
  async (checkpoint) => {
    const { agent, channels, fetch, input, teardown } = setup();
    const error = vi.fn();
    const complete = vi.fn();
    const events: BaseEvent[] = [];
    const subscription = agent.replay(input).subscribe({
      error,
      complete,
      next: (event) => events.push(event),
    });
    try {
      await vi.waitFor(() => expect(channels).toHaveBeenCalledOnce());
      const channel = channels.mock.results[0]!.value;
      channel.triggerJoin("ok");
      if (checkpoint) {
        channel.serverPush("ag_ui_event", {
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId: "answer",
          delta: "partial history",
          metadata: { cpki_event_id: checkpoint },
        });
      }

      channel.serverPush("replay_failed", {
        reason: "history_read_failed",
        retryable: false,
        latestEventId: checkpoint,
      });

      expect(subscription.closed).toBe(true);
      expect(channel.left).toBe(true);
      expect(error).toHaveBeenCalledWith(
        new AgentHistoryReplayError("history_read_failed"),
      );
      expect(complete).not.toHaveBeenCalled();
      // Frames after the terminal failure must not advance the saved checkpoint.
      channel.serverPush("ag_ui_event", {
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: "answer",
        delta: "undelivered",
        metadata: { cpki_event_id: "after-failure" },
      });
      expect(events).toHaveLength(checkpoint ? 1 : 0);

      const nextConnection = agent.replay(input).subscribe({ error });
      try {
        await vi.waitFor(() => expect(channels).toHaveBeenCalledTimes(2));
        expect(JSON.parse(String(fetch.mock.calls[1]![1]?.body))).toMatchObject(
          {
            lastSeenEventId: checkpoint,
          },
        );
        expect(channels.mock.results[1]!.value.params.last_seen_event_id).toBe(
          checkpoint,
        );
      } finally {
        nextConnection.unsubscribe();
      }
    } finally {
      subscription.unsubscribe();
      teardown();
    }
  },
);

test("an unavailable cursor makes the next explicit connect request a fresh restore", async () => {
  const { agent, channels, fetch, input, teardown } = setup();
  const error = vi.fn();
  const initial = agent.replay(input).subscribe({ error });
  try {
    await vi.waitFor(() => expect(channels).toHaveBeenCalledOnce());
    const firstChannel = channels.mock.results[0]!.value;
    firstChannel.triggerJoin("ok");
    firstChannel.serverPush("replay_complete", {
      latestEventId: "expired-cursor",
    });
    firstChannel.serverPush("stream_idle", {
      latestEventId: "expired-cursor",
    });

    const resume = agent.replay(input).subscribe({ error });
    try {
      await vi.waitFor(() => expect(channels).toHaveBeenCalledTimes(2));
      const resumeChannel = channels.mock.results[1]!.value;
      expect(resumeChannel.params.last_seen_event_id).toBe("expired-cursor");
      resumeChannel.triggerJoin("ok");
      resumeChannel.serverPush("replay_failed", {
        reason: "history_cursor_unavailable",
        retryable: false,
        latestEventId: "expired-cursor",
      });

      expect(error).toHaveBeenCalledWith(
        new AgentHistoryReplayError("history_cursor_unavailable"),
      );
      expect(resume.closed).toBe(true);

      const restore = agent.replay(input).subscribe({ error });
      try {
        await vi.waitFor(() => expect(channels).toHaveBeenCalledTimes(3));
        expect(JSON.parse(String(fetch.mock.calls[2]![1]?.body))).toMatchObject(
          {
            lastSeenEventId: null,
          },
        );
        expect(
          channels.mock.results[2]!.value.params.last_seen_event_id,
        ).toBeNull();
      } finally {
        restore.unsubscribe();
      }
    } finally {
      resume.unsubscribe();
    }
  } finally {
    initial.unsubscribe();
    teardown();
  }
});

test("transient replay overload backs off across joins and resumes from delivered checkpoints", async () => {
  const { agent, channels, fetch, input, teardown } = setup();
  vi.useFakeTimers();
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  const error = vi.fn();
  const subscription = agent.replay(input).subscribe({ error });
  try {
    await vi.advanceTimersByTimeAsync(0);
    expect(channels).toHaveBeenCalledOnce();

    for (const [attempt, reason] of [
      "restore_capacity",
      "history_busy",
      "memory_budget",
    ].entries()) {
      const channel = channels.mock.results[attempt]!.value;
      channel.triggerJoin("ok");
      channel.serverPush("ag_ui_event", {
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: "answer",
        delta: `part ${attempt}`,
        metadata: { cpki_event_id: `delivered-${attempt}` },
      });
      channel.serverPush("replay_failed", {
        reason,
        retryable: true,
        latestEventId: `delivered-${attempt}`,
      });

      expect(channel.left).toBe(true);
      expect(error).not.toHaveBeenCalled();
      const delay = 750 * 2 ** attempt;
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(fetch).toHaveBeenCalledTimes(attempt + 1);
      await vi.advanceTimersByTimeAsync(1);
      expect(fetch).toHaveBeenCalledTimes(attempt + 2);
      expect(channels).toHaveBeenCalledTimes(attempt + 2);
      expect(
        JSON.parse(String(fetch.mock.calls[attempt + 1]![1]?.body)),
      ).toMatchObject({ lastSeenEventId: `delivered-${attempt}` });
      expect(
        channels.mock.results[attempt + 1]!.value.params.last_seen_event_id,
      ).toBe(`delivered-${attempt}`);
    }

    const restored = channels.mock.results[3]!.value;
    restored.triggerJoin("ok");
    restored.serverPush("replay_complete", { latestEventId: "restored-20" });
    restored.serverPush("ag_ui_event", {
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId: "answer",
      delta: "live",
      metadata: { cpki_event_id: "live-30" },
    });
    restored.serverPush("replay_failed", {
      reason: "memory_budget",
      retryable: true,
      latestEventId: "live-30",
    });
    await vi.advanceTimersByTimeAsync(749);
    expect(fetch).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(5);
    expect(channels.mock.results[4]!.value.params.last_seen_event_id).toBe(
      "live-30",
    );
    expect(error).not.toHaveBeenCalled();
  } finally {
    subscription.unsubscribe();
    teardown();
  }
});

test("a fresh replay reset clears the full ordered client history before applying its suffix", async () => {
  const { agent, channels, input, teardown } = setup();
  agent.threadId = input.threadId;
  agent.messages = [
    { id: "old-user", role: "user", content: "old question" },
    {
      id: "old-activity",
      role: "activity",
      activityType: "progress",
      content: { old: true },
    },
    { id: "old-reasoning", role: "reasoning", content: "old reasoning" },
  ];
  agent.state = { old: true };
  agent.pendingInterrupts = [{ id: "old-interrupt", reason: "approval" }];
  const { promise: paused, resolve: release } = deferred<void>();
  const onOldContent = vi.fn(() => paused);
  const connection = agent.connectAgent(undefined, {
    onTextMessageContentEvent: ({ event }) =>
      event.delta === "queued old content" ? onOldContent() : undefined,
  });
  try {
    await vi.waitFor(() => expect(channels).toHaveBeenCalledOnce());
    const channel = channels.mock.results[0]!.value;
    channel.triggerJoin("ok");
    channel.serverPush("ag_ui_event", {
      type: EventType.TEXT_MESSAGE_CHUNK,
      messageId: "same-message",
      delta: "queued old content",
      subagentRunId: "child",
    });
    channel.serverPush("ag_ui_event", {
      type: EventType.TOOL_CALL_CHUNK,
      toolCallId: "same-tool",
      toolCallName: "approval",
      parentMessageId: "old-tool-parent",
      delta: '{"old":',
    });
    await vi.waitFor(() => expect(onOldContent).toHaveBeenCalledOnce());

    channel.serverPush("replay_reset", {
      reason: "history_cursor_unavailable",
      latestEventId: null,
    });
    channel.serverPush("ag_ui_event", {
      type: EventType.TEXT_MESSAGE_CHUNK,
      messageId: "same-message",
      delta: "fresh answer",
      subagentRunId: "child",
    });
    channel.serverPush("ag_ui_event", {
      type: EventType.TOOL_CALL_CHUNK,
      toolCallId: "same-tool",
      toolCallName: "approval",
      parentMessageId: "fresh-tool-parent",
      delta: '{"fresh":true}',
    });
    channel.serverPush("ag_ui_event", {
      type: EventType.STATE_DELTA,
      delta: [{ op: "add", path: "/fresh", value: true }],
    });
    channel.serverPush("replay_complete", { latestEventId: "fresh-end" });
    channel.serverPush("stream_idle", { latestEventId: "fresh-end" });
    release();
    await connection;

    expect(agent.messages.map((message) => message.id)).toEqual([
      "same-message",
      "fresh-tool-parent",
    ]);
    expect(agent.messages[0]).toMatchObject({ content: "fresh answer" });
    expect(agent.messages[1]).toMatchObject({
      toolCalls: [
        {
          id: "same-tool",
          function: { name: "approval", arguments: '{"fresh":true}' },
        },
      ],
    });
    expect(agent.state).toEqual({ fresh: true });
    expect(agent.pendingInterrupts).toEqual([]);
    expect(channel.params.supports_replay_reset).toBe(true);
  } finally {
    release();
    await agent.detachActiveRun();
    await connection;
    teardown();
  }
});

test("a terminal replay failure drains delivered events before exposing their reconnect checkpoint", async () => {
  const { agent, channels, input, teardown } = setup();
  agent.threadId = input.threadId;
  const { promise: paused, resolve: release } = deferred<void>();
  const onContent = vi.fn(() => paused);
  const failure = vi.fn();
  const connection = agent
    .connectAgent(undefined, { onTextMessageContentEvent: onContent })
    .catch(failure);
  try {
    await vi.waitFor(() => expect(channels).toHaveBeenCalledOnce());
    const channel = channels.mock.results[0]!.value;
    channel.triggerJoin("ok");
    channel.serverPush("ag_ui_event", {
      type: EventType.TEXT_MESSAGE_START,
      messageId: "answer",
      role: "assistant",
    });
    channel.serverPush("ag_ui_event", {
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId: "answer",
      delta: "delivered",
      metadata: { cpki_event_id: "content-10" },
    });
    await vi.waitFor(() => expect(onContent).toHaveBeenCalledOnce());

    channel.serverPush("replay_failed", {
      reason: "history_read_failed",
      retryable: false,
      latestEventId: "content-10",
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(failure).not.toHaveBeenCalled();
    expect(channel.left).toBe(true);
    release();
    await connection;
    expect(failure).toHaveBeenCalledWith(
      new AgentHistoryReplayError("history_read_failed"),
    );
    expect(agent.messages[0]).toMatchObject({ content: "delivered" });

    const resumed = agent.connectAgent();
    await vi.waitFor(() => expect(channels).toHaveBeenCalledTimes(2));
    const next = channels.mock.results[1]!.value;
    expect(next.params.last_seen_event_id).toBe("content-10");
    next.triggerJoin("ok");
    next.serverPush("ag_ui_event", {
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId: "answer",
      delta: " and resumed",
    });
    next.serverPush("replay_complete", { latestEventId: "content-20" });
    next.serverPush("stream_idle", { latestEventId: "content-20" });
    await resumed;
    expect(agent.messages[0]).toMatchObject({
      content: "delivered and resumed",
    });
  } finally {
    release();
    await agent.detachActiveRun();
    await connection;
    teardown();
  }
});

test.each(["backoff", "credentials"] as const)(
  "unsubscribe during replay %s prevents a late reconnect",
  async (phase) => {
    const { agent, channels, fetch, input, teardown } = setup();
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const error = vi.fn();
    const { promise: credentials, resolve: resolveCredentials } =
      deferred<Response>();
    const subscription = agent.replay(input).subscribe({ error });
    try {
      await vi.advanceTimersByTimeAsync(0);
      const first = channels.mock.results[0]!.value;
      first.triggerJoin("ok");
      first.serverPush("replay_failed", {
        reason: "history_busy",
        retryable: true,
        latestEventId: null,
      });
      // A duplicate frame from the failed channel cannot schedule another retry.
      first.serverPush("replay_failed", {
        reason: "history_busy",
        retryable: true,
        latestEventId: "undelivered",
      });
      if (phase === "credentials") {
        fetch.mockReturnValueOnce(credentials);
        await vi.advanceTimersByTimeAsync(750);
        expect(fetch).toHaveBeenCalledTimes(2);
      }

      subscription.unsubscribe();
      resolveCredentials(
        new Response(
          JSON.stringify({
            threadId: input.threadId,
            joinToken: "late-token",
            realtime: {
              clientUrl: "ws://localhost:4000/client",
              topic: `thread:${input.threadId}`,
            },
          }),
        ),
      );
      await vi.advanceTimersByTimeAsync(60_000);

      expect(fetch).toHaveBeenCalledTimes(phase === "backoff" ? 1 : 2);
      expect(channels).toHaveBeenCalledOnce();
      expect(first.left).toBe(true);
      expect(error).not.toHaveBeenCalled();
    } finally {
      subscription.unsubscribe();
      teardown();
    }
  },
);

test.each([0, 0.99])(
  "replay overload delay is jittered and capped when random is %s",
  async (random) => {
    const { agent, channels, fetch, input, teardown } = setup();
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(random);
    const subscription = agent.replay(input).subscribe();
    try {
      await vi.advanceTimersByTimeAsync(0);
      for (let attempt = 0; attempt < 8; attempt++) {
        const channel = channels.mock.results[attempt]!.value;
        channel.triggerJoin("ok");
        channel.serverPush("replay_failed", {
          reason: "restore_capacity",
          retryable: true,
          latestEventId: null,
        });
        const delay = Math.floor(
          Math.min(1_000 * 2 ** attempt, 30_000) * (0.5 + random * 0.5),
        );
        await vi.advanceTimersByTimeAsync(delay - 1);
        expect(fetch).toHaveBeenCalledTimes(attempt + 1);
        await vi.advanceTimersByTimeAsync(1);
        expect(channels).toHaveBeenCalledTimes(attempt + 2);
      }
    } finally {
      subscription.unsubscribe();
      teardown();
    }
  },
);

test.each([
  "history_read_timeout",
  "history_read_failed",
  "history_event_too_large",
  "history_tail_too_large",
  "spool_corrupt",
])("fixed replay failure %s never automatically reconnects", async (reason) => {
  const { agent, channels, fetch, input, teardown } = setup();
  vi.useFakeTimers();
  const error = vi.fn();
  const subscription = agent.replay(input).subscribe({ error });
  try {
    await vi.advanceTimersByTimeAsync(0);
    const channel = channels.mock.results[0]!.value;
    channel.triggerJoin("ok");
    channel.serverPush("replay_failed", {
      reason,
      retryable: false,
      latestEventId: null,
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(error).toHaveBeenCalledWith(new AgentHistoryReplayError(reason));
    expect(fetch).toHaveBeenCalledOnce();
    expect(channels).toHaveBeenCalledOnce();
  } finally {
    subscription.unsubscribe();
    teardown();
  }
});

test("retryable replay preserves async delivered content while the next restore begins", async () => {
  const { agent, channels, input, teardown } = setup();
  agent.threadId = input.threadId;
  vi.useFakeTimers();
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  const { promise: paused, resolve: release } = deferred<void>();
  const onContent = vi.fn(({ event }: { event: { delta: string } }) =>
    event.delta === "delivered" ? paused : undefined,
  );
  const connection = agent.connectAgent(undefined, {
    onTextMessageContentEvent: onContent,
  });
  try {
    await vi.advanceTimersByTimeAsync(0);
    const first = channels.mock.results[0]!.value;
    first.triggerJoin("ok");
    first.serverPush("ag_ui_event", {
      type: EventType.TEXT_MESSAGE_START,
      messageId: "answer",
      role: "assistant",
    });
    first.serverPush("ag_ui_event", {
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId: "answer",
      delta: "delivered",
      metadata: { cpki_event_id: "content-10" },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(onContent).toHaveBeenCalledOnce();
    first.serverPush("replay_failed", {
      reason: "memory_budget",
      retryable: true,
      latestEventId: "content-10",
    });
    await vi.advanceTimersByTimeAsync(750);
    const second = channels.mock.results[1]!.value;
    expect(second.params.last_seen_event_id).toBe("content-10");
    second.triggerJoin("ok");
    second.serverPush("ag_ui_event", {
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId: "answer",
      delta: " and resumed",
    });
    second.serverPush("replay_complete", { latestEventId: "content-20" });
    second.serverPush("stream_idle", { latestEventId: "content-20" });
    release();
    await connection;

    expect(agent.messages).toHaveLength(1);
    expect(agent.messages[0]).toMatchObject({
      content: "delivered and resumed",
    });
  } finally {
    release();
    await agent.detachActiveRun();
    await connection;
    teardown();
  }
});

test.each(["detach", "abort"] as const)(
  "%s cancels a public connection waiting to retry history",
  async (action) => {
    const { agent, channels, fetch, input, teardown } = setup();
    agent.threadId = input.threadId;
    vi.useFakeTimers();
    const connection = agent.connectAgent();
    try {
      await vi.advanceTimersByTimeAsync(0);
      const channel = channels.mock.results[0]!.value;
      channel.triggerJoin("ok");
      channel.serverPush("replay_failed", {
        reason: "history_busy",
        retryable: true,
        latestEventId: null,
      });

      if (action === "detach") await agent.detachActiveRun();
      else agent.abortRun();
      await connection;
      await vi.advanceTimersByTimeAsync(60_000);

      expect(fetch).toHaveBeenCalledOnce();
      expect(channels).toHaveBeenCalledOnce();
      expect(channel.left).toBe(true);
      expect(agent.isRunning).toBe(false);
    } finally {
      await agent.detachActiveRun();
      await connection;
      teardown();
    }
  },
);

test("failure before a fresh replay delivers an event leaves history and reconnect cursor empty", async () => {
  const { agent, channels, input, teardown } = setup();
  agent.threadId = input.threadId;
  const seed = agent.replay(input).subscribe();
  let connection: Promise<unknown> | undefined;
  try {
    await vi.waitFor(() => expect(channels).toHaveBeenCalledOnce());
    channels.mock.results[0]!.value.triggerJoin("ok");
    channels.mock.results[0]!.value.serverPush("replay_complete", {
      latestEventId: "expired",
    });
    seed.unsubscribe();
    agent.messages = [{ id: "old", role: "user", content: "old history" }];
    agent.state = { old: true };
    const failure = vi.fn();
    connection = agent.connectAgent().catch(failure);
    await vi.waitFor(() => expect(channels).toHaveBeenCalledTimes(2));
    const fallback = channels.mock.results[1]!.value;
    expect(fallback.params.last_seen_event_id).toBe("expired");
    fallback.triggerJoin("ok");
    fallback.serverPush("replay_reset", {
      reason: "history_cursor_unavailable",
      latestEventId: null,
    });
    fallback.serverPush("replay_failed", {
      reason: "spool_corrupt",
      retryable: false,
      latestEventId: null,
    });
    await connection;

    expect(failure).toHaveBeenCalledWith(
      new AgentHistoryReplayError("spool_corrupt"),
    );
    expect(agent.messages).toEqual([]);
    expect(agent.state).toEqual({});
    const next = agent.replay(input).subscribe();
    try {
      await vi.waitFor(() => expect(channels).toHaveBeenCalledTimes(3));
      expect(
        channels.mock.results[2]!.value.params.last_seen_event_id,
      ).toBeNull();
    } finally {
      next.unsubscribe();
    }
  } finally {
    seed.unsubscribe();
    await agent.detachActiveRun();
    await connection;
    teardown();
  }
});

test("the runtime proxy clears stale approvals when the fresh replay reset applies", async () => {
  const { channels, input, teardown } = setup();
  const agent = new ProxiedCopilotRuntimeAgent({
    runtimeUrl: "http://localhost:4000",
    runtimeMode: "intelligence",
    intelligence: { wsUrl: "ws://localhost:4000/client" },
    agentId: "agent-1",
  });
  agent.threadId = input.threadId;
  agent.messages = [{ id: "old", role: "user", content: "old history" }];
  agent.pendingInterrupts = [{ id: "old-approval", reason: "approval" }];
  const connection = agent.connectAgent();
  try {
    await vi.waitFor(() => expect(channels).toHaveBeenCalledOnce());
    const channel = channels.mock.results[0]!.value;
    channel.triggerJoin("ok");
    channel.serverPush("replay_reset", {
      reason: "history_cursor_unavailable",
      latestEventId: null,
    });

    await vi.waitFor(() => expect(agent.messages).toEqual([]));
    expect(agent.isRunning).toBe(true);
    expect(agent.pendingInterrupts).toEqual([]);
  } finally {
    const channel = channels.mock.results[0]?.value;
    channel?.serverPush("replay_complete", { latestEventId: null });
    channel?.serverPush("stream_idle", { latestEventId: null });
    await agent.detachActiveRun();
    await connection;
    teardown();
  }
});

test("Core reports a terminal history restore failure once through the normal failure lifecycle", async () => {
  const { agent, channels, input, teardown } = setup();
  agent.threadId = input.threadId;
  const onError = vi.fn();
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  const core = new CopilotKitCore({});
  const errors = core.subscribe({ onError });
  const connection = core.connectAgent({ agent });
  try {
    await vi.waitFor(() => expect(channels).toHaveBeenCalledOnce());
    const channel = channels.mock.results[0]!.value;
    channel.triggerJoin("ok");
    channel.serverPush("replay_failed", {
      reason: "history_read_timeout",
      retryable: false,
      latestEventId: null,
    });
    await connection;
    expect(onError).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        code: "agent_history_replay_failed",
        error: new AgentHistoryReplayError("history_read_timeout"),
        context: { agentId: agent.agentId, threadId: input.threadId },
      }),
    );
    expect(consoleError).toHaveBeenCalledOnce();
    expect(agent.isRunning).toBe(false);
    expect(channel.left).toBe(true);
  } finally {
    await agent.detachActiveRun();
    await connection;
    errors.unsubscribe();
    teardown();
  }
});

test("connect drains async events without AG-UI's private source-error helper", async () => {
  const { agent, channels, input, teardown } = setup();
  vi.useFakeTimers();
  agent.threadId = input.threadId;
  Object.defineProperty(agent, "applyBeforeSourceError", { value: undefined });
  const pending = deferred<void>();
  const onContent = vi.fn(() => pending.promise);
  const failure = vi.fn();
  const connection = agent
    .connectAgent(undefined, {
      onTextMessageContentEvent: onContent,
    })
    .catch(failure);
  try {
    await vi.advanceTimersByTimeAsync(0);
    expect(failure).not.toHaveBeenCalled();
    expect(channels).toHaveBeenCalledOnce();
    const channel = channels.mock.results[0]!.value;
    channel.triggerJoin("ok");
    channel.serverPush("ag_ui_event", {
      type: EventType.TEXT_MESSAGE_CHUNK,
      messageId: "answer",
      delta: "delivered before failure",
      metadata: { cpki_event_id: "content-10" },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(onContent).toHaveBeenCalledOnce();
    channel.serverPush("replay_failed", {
      reason: "history_read_failed",
      retryable: false,
      latestEventId: "content-10",
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(failure).not.toHaveBeenCalled();
    pending.resolve();
    await connection;
    expect(failure).toHaveBeenCalledExactlyOnceWith(
      new AgentHistoryReplayError("history_read_failed"),
    );
    expect(agent.messages).toEqual([
      expect.objectContaining({
        id: "answer",
        content: "delivered before failure",
      }),
    ]);
    expect(agent.isRunning).toBe(false);
  } finally {
    pending.resolve();
    await agent.detachActiveRun();
    await connection;
    teardown();
  }
});

test("Phoenix rejoin reads the current cursor after a reset and subsequent delivery", async () => {
  const { agent, channels, fetch, input, teardown } = setup();
  vi.useFakeTimers();
  const failure = vi.fn();
  const initial = agent.replay(input).subscribe({ error: failure });
  try {
    await vi.advanceTimersByTimeAsync(0);
    const first = channels.mock.results[0]!.value;
    first.triggerJoin("ok");
    first.serverPush("replay_complete", { latestEventId: "expired" });
    first.serverPush("stream_idle", { latestEventId: "expired" });
    const resumed = agent.replay(input).subscribe({ error: failure });
    try {
      await vi.advanceTimersByTimeAsync(0);
      const channel = channels.mock.results[1]!.value;
      expect(channel.params.last_seen_event_id).toBe("expired");
      channel.triggerJoin("ok");
      channel.serverPush("replay_reset", {
        reason: "history_cursor_unavailable",
        latestEventId: null,
      });
      channel.triggerError();
      // Phoenix evaluates the same params closure for each join push.
      channel.join();
      expect(channel.params.last_seen_event_id).toBeNull();
      channel.triggerJoin("ok");
      channel.serverPush("ag_ui_event", {
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: "answer",
        delta: "fresh",
        metadata: { cpki_event_id: "fresh-30" },
      });
      channel.triggerError();
      channel.join();
      expect(channel.params.last_seen_event_id).toBe("fresh-30");
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(failure).not.toHaveBeenCalled();
    } finally {
      resumed.unsubscribe();
    }
  } finally {
    initial.unsubscribe();
    teardown();
  }
});

test.each([
  { control: { latest_event_id: null }, expected: null },
  {
    control: { latestEventId: null, latest_event_id: "stale" },
    expected: null,
  },
  {
    control: { latestEventId: "safe", latest_event_id: null },
    expected: "safe",
  },
  { control: {}, expected: "old" },
])(
  "terminal checkpoint aliases are unambiguous: $control",
  async ({ control, expected }) => {
    const { agent, channels, fetch, input, teardown } = setup();
    vi.useFakeTimers();
    const failure = vi.fn();
    const initial = agent.replay(input).subscribe({ error: failure });
    try {
      await vi.advanceTimersByTimeAsync(0);
      const first = channels.mock.results[0]!.value;
      first.triggerJoin("ok");
      first.serverPush("replay_complete", { latestEventId: "old" });
      first.serverPush("stream_idle", { latestEventId: "old" });
      const resumed = agent.replay(input).subscribe({ error: failure });
      try {
        await vi.advanceTimersByTimeAsync(0);
        const channel = channels.mock.results[1]!.value;
        channel.triggerJoin("ok");
        channel.serverPush("replay_failed", {
          reason: "history_read_failed",
          retryable: false,
          ...control,
        });
        expect(failure).toHaveBeenCalledExactlyOnceWith(
          new AgentHistoryReplayError("history_read_failed"),
        );
        const next = agent.replay(input).subscribe({ error: failure });
        try {
          await vi.advanceTimersByTimeAsync(0);
          expect(
            JSON.parse(String(fetch.mock.calls[2]![1]?.body)),
          ).toMatchObject({ lastSeenEventId: expected });
        } finally {
          next.unsubscribe();
        }
      } finally {
        resumed.unsubscribe();
      }
    } finally {
      initial.unsubscribe();
      teardown();
    }
  },
);

test("successful restoration resets the recovery clock and the next exhausted episode reports its last reason", async () => {
  const { agent, channels, fetch, input, teardown } = setup();
  vi.useFakeTimers();
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const failure = vi.fn();
  const subscription = agent.replay(input).subscribe({ error: failure });
  try {
    await vi.advanceTimersByTimeAsync(0);
    const first = channels.mock.results[0]!.value;
    first.triggerJoin("ok");
    first.serverPush("replay_failed", {
      reason: "history_busy",
      retryable: true,
    });
    await vi.advanceTimersByTimeAsync(750);
    const second = channels.mock.results[1]!.value;
    second.triggerJoin("ok");
    await vi.advanceTimersByTimeAsync(298_250);
    second.serverPush("replay_complete", { latestEventId: "restored" });
    await vi.advanceTimersByTimeAsync(1_001);
    expect(failure).not.toHaveBeenCalled();
    second.serverPush("replay_failed", {
      reason: "memory_budget",
      retryable: true,
    });
    await vi.advanceTimersByTimeAsync(749);
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    const third = channels.mock.results[2]!.value;
    third.triggerJoin("ok");
    third.serverPush("replay_failed", {
      reason: "restore_capacity",
      retryable: true,
    });
    await vi.advanceTimersByTimeAsync(299_249);
    expect(failure).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(failure).toHaveBeenCalledExactlyOnceWith(
      new AgentHistoryReplayError("restore_capacity"),
    );
    expect(subscription.closed).toBe(true);
    const requests = fetch.mock.calls.length;
    await vi.advanceTimersByTimeAsync(300_000);
    expect(fetch).toHaveBeenCalledTimes(requests);
  } finally {
    subscription.unsubscribe();
    teardown();
  }
});

test("an exhausted public connect rejects once and clears running state", async () => {
  const { agent, channels, input, teardown } = setup();
  vi.useFakeTimers();
  vi.spyOn(console, "error").mockImplementation(() => {});
  agent.threadId = input.threadId;
  const failure = vi.fn();
  const onRunFailed = vi.fn();
  const connection = agent
    .connectAgent(undefined, { onRunFailed })
    .catch(failure);
  try {
    await vi.advanceTimersByTimeAsync(0);
    const first = channels.mock.results[0]!.value;
    first.triggerJoin("ok");
    first.serverPush("replay_failed", {
      reason: "history_busy",
      retryable: true,
    });
    expect(agent.isRunning).toBe(true);
    await vi.advanceTimersByTimeAsync(300_000);
    await connection;
    expect(failure).toHaveBeenCalledExactlyOnceWith(
      new AgentHistoryReplayError("history_busy"),
    );
    expect(onRunFailed).toHaveBeenCalledOnce();
    expect(agent.isRunning).toBe(false);
  } finally {
    await agent.detachActiveRun();
    await connection;
    teardown();
  }
});

test.each(["direct", "proxy"] as const)(
  "Core run recovery reports one history failure after applying its delivered prefix (%s)",
  async (transport) => {
    const { agent: direct, channels, input, teardown } = setup();
    vi.useFakeTimers();
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const agent =
      transport === "direct"
        ? direct
        : new ProxiedCopilotRuntimeAgent({
            runtimeUrl: "http://localhost:4000",
            runtimeMode: "intelligence",
            intelligence: { wsUrl: "ws://localhost:4000/client" },
            agentId: "agent-1",
          });
    agent.threadId = input.threadId;
    const pending = deferred<void>();
    const onContent = vi.fn(() => pending.promise);
    const agentSubscriber = agent.subscribe({
      onTextMessageContentEvent: ({ event }) =>
        event.delta === " after reconnect" ? onContent() : undefined,
    });
    const onError = vi.fn();
    const core = new CopilotKitCore({});
    const errors = core.subscribe({ onError });
    core.addAgent__unsafe_dev_only({ id: "agent-1", agent });
    const run = core.runAgent({ agent, runId: input.runId });
    try {
      await vi.advanceTimersByTimeAsync(0);
      const first = channels.mock.results[0]!.value;
      first.triggerJoin("ok");
      first.serverPush("ag_ui_event", {
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
      });
      first.serverPush("ag_ui_event", {
        type: EventType.TEXT_MESSAGE_START,
        messageId: "answer",
        role: "assistant",
      });
      first.serverPush("ag_ui_event", {
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: "answer",
        delta: "before",
        metadata: { cpki_event_id: "before-10" },
      });
      await vi.advanceTimersByTimeAsync(0);
      const socket = channels.mock.contexts[0];
      if (!(socket instanceof MockSocket))
        throw new Error("Missing original socket");
      for (let attempt = 0; attempt < 5; attempt++)
        socket.triggerError(new Error("transport dropped"));
      await vi.advanceTimersByTimeAsync(0);
      expect(channels).toHaveBeenCalledTimes(2);
      const recovery = channels.mock.results[1]!.value;
      expect(recovery.params).toMatchObject({
        stream_mode: "connect",
        last_seen_event_id: "before-10",
      });
      recovery.triggerJoin("ok");
      recovery.serverPush("ag_ui_event", {
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: "answer",
        delta: " after reconnect",
        metadata: { cpki_event_id: "after-20" },
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(onContent).toHaveBeenCalledOnce();
      recovery.serverPush("replay_failed", {
        reason: "history_read_failed",
        retryable: false,
        latestEventId: "after-20",
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(onError).not.toHaveBeenCalled();
      pending.resolve();
      await run;
      expect(agent.messages).toEqual([
        expect.objectContaining({
          id: "answer",
          content: "before after reconnect",
        }),
      ]);
      expect(onError).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          code: "agent_history_replay_failed",
          error: new AgentHistoryReplayError("history_read_failed"),
        }),
      );
      expect(consoleError).toHaveBeenCalledOnce();
      expect(agent.isRunning).toBe(false);
      const resumed = agent.connectAgent();
      await vi.advanceTimersByTimeAsync(0);
      const next = channels.mock.results[2]!.value;
      expect(next.params.last_seen_event_id).toBe("after-20");
      next.triggerJoin("ok");
      next.serverPush("replay_complete", { latestEventId: "after-20" });
      next.serverPush("stream_idle", { latestEventId: "after-20" });
      await resumed;
    } finally {
      pending.resolve();
      await agent.detachActiveRun();
      await run;
      agentSubscriber.unsubscribe();
      errors.unsubscribe();
      teardown();
    }
  },
);

test.each([
  { transport: "direct", historyFailure: true },
  { transport: "proxy", historyFailure: true },
  { transport: "direct", historyFailure: false },
  { transport: "proxy", historyFailure: false },
])(
  "direct run callers still reject: $transport, history=$historyFailure",
  async ({ transport, historyFailure }) => {
    const { agent: direct, channels, fetch, input, teardown } = setup();
    vi.useFakeTimers();
    const agent =
      transport === "direct"
        ? direct
        : new ProxiedCopilotRuntimeAgent({
            runtimeUrl: "http://localhost:4000",
            runtimeMode: "intelligence",
            intelligence: { wsUrl: "ws://localhost:4000/client" },
            agentId: "agent-1",
          });
    agent.threadId = input.threadId;
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const failure = vi.fn();
    const onRunFailed = vi.fn();
    if (!historyFailure)
      fetch.mockResolvedValueOnce(
        new Response("run unavailable", { status: 503 }),
      );
    const run = agent
      .runAgent({ runId: input.runId }, { onRunFailed })
      .catch(failure);
    try {
      await vi.advanceTimersByTimeAsync(0);
      if (historyFailure) {
        const channel = channels.mock.results[0]!.value;
        channel.triggerJoin("ok");
        channel.serverPush("ag_ui_event", {
          type: EventType.RUN_STARTED,
          threadId: input.threadId,
          runId: input.runId,
        });
        channel.serverPush("replay_failed", {
          reason: "history_read_failed",
          retryable: false,
          latestEventId: null,
        });
      }
      await run;
      expect(failure).toHaveBeenCalledExactlyOnceWith(
        historyFailure
          ? new AgentHistoryReplayError("history_read_failed")
          : new Error("REST run request failed: run unavailable"),
      );
      expect(onRunFailed).toHaveBeenCalledOnce();
      expect(consoleError).toHaveBeenCalledOnce();
      expect(agent.isRunning).toBe(false);
    } finally {
      await agent.detachActiveRun();
      await run;
      teardown();
    }
  },
);

test.each(["direct", "proxy"] as const)(
  "active-run recovery declines fresh reset and clears an unavailable cursor for explicit connect (%s)",
  async (transport) => {
    const { agent: direct, channels, input, teardown } = setup();
    vi.useFakeTimers();
    const agent =
      transport === "direct"
        ? direct
        : new ProxiedCopilotRuntimeAgent({
            runtimeUrl: "http://localhost:4000",
            runtimeMode: "intelligence",
            intelligence: { wsUrl: "ws://localhost:4000/client" },
            agentId: "agent-1",
          });
    agent.threadId = input.threadId;
    const failure = vi.fn();
    const run = agent.runAgent({ runId: input.runId }).catch(failure);
    try {
      await vi.advanceTimersByTimeAsync(0);
      const first = channels.mock.results[0]!.value;
      first.triggerJoin("ok");
      first.serverPush("ag_ui_event", {
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
        metadata: { cpki_event_id: "expired" },
      });
      await vi.advanceTimersByTimeAsync(0);
      const socket = channels.mock.contexts[0];
      if (!(socket instanceof MockSocket))
        throw new Error("Missing original socket");
      for (let attempt = 0; attempt < 5; attempt++)
        socket.triggerError(new Error("transport dropped"));
      await vi.advanceTimersByTimeAsync(0);
      const recovery = channels.mock.results[1]!.value;
      expect(recovery.params).toMatchObject({
        stream_mode: "connect",
        supports_replay_reset: false,
        last_seen_event_id: "expired",
      });
      recovery.triggerJoin("ok");
      recovery.triggerError();
      recovery.join();
      expect(recovery.params.supports_replay_reset).toBe(false);
      recovery.triggerJoin("ok");
      recovery.serverPush("replay_failed", {
        reason: "history_cursor_unavailable",
        retryable: false,
        latestEventId: "expired",
      });
      await run;
      expect(failure).toHaveBeenCalledExactlyOnceWith(
        new AgentHistoryReplayError("history_cursor_unavailable"),
      );
      expect(agent.isRunning).toBe(false);
      const explicit = agent.connectAgent();
      await vi.advanceTimersByTimeAsync(0);
      const fresh = channels.mock.results[2]!.value;
      expect(fresh.params).toMatchObject({
        supports_replay_reset: true,
        last_seen_event_id: null,
      });
      fresh.triggerJoin("ok");
      fresh.serverPush("replay_complete", { latestEventId: null });
      fresh.serverPush("stream_idle", { latestEventId: null });
      await explicit;
    } finally {
      await agent.detachActiveRun();
      await run;
      teardown();
    }
  },
);

test.each([
  { transport: "direct", started: false },
  { transport: "proxy", started: false },
  { transport: "direct", started: true },
  { transport: "proxy", started: true },
] as const)(
  "active-run recovery rejects foreign history before applying it ($transport, started=$started)",
  async ({ transport, started }) => {
    const { agent: direct, channels, fetch, input, teardown } = setup();
    vi.useFakeTimers();
    const agent =
      transport === "direct"
        ? direct
        : new ProxiedCopilotRuntimeAgent({
            runtimeUrl: "http://localhost:4000",
            runtimeMode: "intelligence",
            intelligence: { wsUrl: "ws://localhost:4000/client" },
            agentId: "agent-1",
          });
    agent.threadId = input.threadId;
    const failure = vi.fn();
    const finished = vi.fn();
    const run = agent
      .runAgent({ runId: input.runId }, { onRunFinishedEvent: finished })
      .catch(failure);
    try {
      await vi.advanceTimersByTimeAsync(0);
      const first = channels.mock.results[0]!.value;
      first.triggerJoin("ok");
      if (started)
        first.serverPush("ag_ui_event", {
          type: EventType.RUN_STARTED,
          threadId: input.threadId,
          runId: input.runId,
          metadata: { cpki_event_id: "current-10" },
        });
      await vi.advanceTimersByTimeAsync(0);
      fetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            threadId: input.threadId,
            runId: "other-run",
            joinToken: "refreshed",
            realtime: {
              clientUrl: "ws://localhost:4000/client",
              topic: `thread:${input.threadId}`,
            },
          }),
        ),
      );
      const socket = channels.mock.contexts[0];
      if (!(socket instanceof MockSocket))
        throw new Error("Missing original socket");
      for (let attempt = 0; attempt < 5; attempt++)
        socket.triggerError(new Error("transport dropped"));
      await vi.advanceTimersByTimeAsync(0);
      const recovery = channels.mock.results[1]!.value;
      recovery.triggerJoin("ok");
      recovery.serverPush("ag_ui_event", {
        type: started ? EventType.RUN_FINISHED : EventType.RUN_STARTED,
        threadId: input.threadId,
        // The authenticated routing field takes precedence over raw payload identity.
        ...(started
          ? { run_id: "other-run", runId: input.runId }
          : { runId: "other-run" }),
        metadata: { cpki_event_id: "foreign-20" },
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(failure).toHaveBeenCalledExactlyOnceWith(
        new AgentHistoryReplayError("history_run_mismatch"),
      );
      expect(finished).not.toHaveBeenCalled();
      expect(agent.isRunning).toBe(false);
      const explicit = agent.connectAgent();
      await vi.advanceTimersByTimeAsync(0);
      const fresh = channels.mock.results[2]!.value;
      expect(fresh.params.last_seen_event_id).toBeNull();
      fresh.triggerJoin("ok");
      fresh.serverPush("replay_complete", { latestEventId: null });
      fresh.serverPush("stream_idle", { latestEventId: null });
      await explicit;
    } finally {
      await agent.detachActiveRun();
      await run;
      teardown();
    }
  },
);

test.each(["direct", "proxy"] as const)(
  "active-run recovery reports idle without its terminal event (%s)",
  async (transport) => {
    const { agent: direct, channels, input, teardown } = setup();
    vi.useFakeTimers();
    const agent =
      transport === "direct"
        ? direct
        : new ProxiedCopilotRuntimeAgent({
            runtimeUrl: "http://localhost:4000",
            runtimeMode: "intelligence",
            intelligence: { wsUrl: "ws://localhost:4000/client" },
            agentId: "agent-1",
          });
    agent.threadId = input.threadId;
    const failure = vi.fn();
    const run = agent.runAgent({ runId: input.runId }).catch(failure);
    try {
      await vi.advanceTimersByTimeAsync(0);
      const first = channels.mock.results[0]!.value;
      first.triggerJoin("ok");
      first.serverPush("ag_ui_event", {
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
        metadata: { cpki_event_id: "current-10" },
      });
      const socket = channels.mock.contexts[0];
      if (!(socket instanceof MockSocket))
        throw new Error("Missing original socket");
      for (let attempt = 0; attempt < 5; attempt++)
        socket.triggerError(new Error("transport dropped"));
      await vi.advanceTimersByTimeAsync(0);
      const recovery = channels.mock.results[1]!.value;
      recovery.triggerJoin("ok");
      recovery.serverPush("replay_complete", { latestEventId: "current-10" });
      await vi.advanceTimersByTimeAsync(0);
      expect(failure).not.toHaveBeenCalled();
      recovery.serverPush("stream_idle", { latestEventId: "current-10" });
      await vi.advanceTimersByTimeAsync(0);
      expect(failure).toHaveBeenCalledExactlyOnceWith(
        new AgentHistoryReplayError("history_run_incomplete"),
      );
      expect(agent.isRunning).toBe(false);
      const explicit = agent.connectAgent();
      await vi.advanceTimersByTimeAsync(0);
      const fresh = channels.mock.results[2]!.value;
      expect(fresh.params.last_seen_event_id).toBeNull();
      fresh.triggerJoin("ok");
      fresh.serverPush("replay_complete", { latestEventId: null });
      fresh.serverPush("stream_idle", { latestEventId: null });
      await explicit;
    } finally {
      await agent.detachActiveRun();
      await run;
      teardown();
    }
  },
);

test("active-run recovery rejects empty credentials instead of completing an unfinished run", async () => {
  const { agent, channels, fetch, input, teardown } = setup();
  vi.useFakeTimers();
  agent.threadId = input.threadId;
  const failure = vi.fn();
  const run = agent.runAgent({ runId: input.runId }).catch(failure);
  try {
    await vi.advanceTimersByTimeAsync(0);
    channels.mock.results[0]!.value.triggerJoin("ok");
    fetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const socket = channels.mock.contexts[0];
    if (!(socket instanceof MockSocket))
      throw new Error("Missing original socket");
    for (let attempt = 0; attempt < 5; attempt++)
      socket.triggerError(new Error("transport dropped"));
    await vi.advanceTimersByTimeAsync(0);
    expect(failure).toHaveBeenCalledExactlyOnceWith(
      new AgentHistoryReplayError("history_run_incomplete"),
    );
    expect(agent.isRunning).toBe(false);
  } finally {
    await agent.detachActiveRun();
    await run;
    teardown();
  }
});

test.each(["direct", "proxy"] as const)(
  "active-run recovery preserves its identity and drains its terminal before idle (%s)",
  async (transport) => {
    const { agent: direct, channels, fetch, input, teardown } = setup();
    vi.useFakeTimers();
    const agent =
      transport === "direct"
        ? direct
        : new ProxiedCopilotRuntimeAgent({
            runtimeUrl: "http://localhost:4000",
            runtimeMode: "intelligence",
            intelligence: { wsUrl: "ws://localhost:4000/client" },
            agentId: "agent-1",
          });
    agent.threadId = input.threadId;
    const pending = deferred<void>();
    const failure = vi.fn();
    const finished = vi.fn();
    const run = agent
      .runAgent(
        { runId: input.runId },
        {
          onRunFinishedEvent: finished,
          onTextMessageContentEvent: () => pending.promise,
        },
      )
      .catch(failure);
    try {
      await vi.advanceTimersByTimeAsync(0);
      const first = channels.mock.results[0]!.value;
      first.triggerJoin("ok");
      first.serverPush("ag_ui_event", {
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
        metadata: { cpki_event_id: "current-10" },
      });
      await vi.advanceTimersByTimeAsync(0);
      fetch.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            threadId: input.threadId,
            runId: "other-run",
            joinToken: "refreshed",
            realtime: {
              clientUrl: "ws://localhost:4000/client",
              topic: `thread:${input.threadId}`,
            },
          }),
        ),
      );
      const socket = channels.mock.contexts[0];
      if (!(socket instanceof MockSocket))
        throw new Error("Missing original socket");
      for (let attempt = 0; attempt < 5; attempt++)
        socket.triggerError(new Error("transport dropped"));
      await vi.advanceTimersByTimeAsync(0);
      const recovery = channels.mock.results[1]!.value;
      recovery.triggerJoin("ok");
      recovery.serverPush("ag_ui_event", {
        type: EventType.TEXT_MESSAGE_START,
        messageId: "current-text",
        role: "assistant",
        run_id: input.runId,
      });
      recovery.serverPush("ag_ui_event", {
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: "current-text",
        delta: "recovered",
        run_id: input.runId,
      });
      recovery.serverPush("ag_ui_event", {
        type: EventType.TEXT_MESSAGE_END,
        messageId: "current-text",
        run_id: input.runId,
      });
      recovery.serverPush("ag_ui_event", {
        type: EventType.RUN_FINISHED,
        threadId: input.threadId,
        runId: input.runId,
        run_id: input.runId,
        metadata: { cpki_event_id: "current-20" },
      });
      recovery.serverPush("stream_idle", { latestEventId: "current-20" });
      await vi.advanceTimersByTimeAsync(0);
      expect(failure).not.toHaveBeenCalled();
      expect(finished).not.toHaveBeenCalled();
      expect(agent.isRunning).toBe(true);
      pending.resolve();
      await run;
      expect(failure).not.toHaveBeenCalled();
      expect(finished).toHaveBeenCalledOnce();
      expect(agent.messages).toEqual([
        expect.objectContaining({ id: "current-text", content: "recovered" }),
      ]);
      expect(agent.isRunning).toBe(false);
    } finally {
      pending.resolve();
      await agent.detachActiveRun();
      await run;
      teardown();
    }
  },
);

test.each([
  { transport: "direct", mode: "connect" },
  { transport: "proxy", mode: "connect" },
  { transport: "direct", mode: "run" },
  { transport: "proxy", mode: "run" },
] as const)(
  "terminal replay failure reconciles pending tool results and notifies once ($transport, $mode)",
  async ({ transport, mode }) => {
    const { agent: direct, channels, input, teardown } = setup();
    vi.useFakeTimers();
    const agent =
      transport === "direct"
        ? direct
        : new ProxiedCopilotRuntimeAgent({
            runtimeUrl: "http://localhost:4000",
            runtimeMode: "intelligence",
            intelligence: { wsUrl: "ws://localhost:4000/client" },
            agentId: "agent-1",
          });
    agent.threadId = input.threadId;
    const core = new CopilotKitCore({});
    core.addAgent__unsafe_dev_only({ id: "agent-1", agent });
    const onError = vi.fn();
    const errors = core.subscribe({ onError });
    const onRunFailed = vi.fn();
    const lifecycle = agent.subscribe({ onRunFailed });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const operation =
      mode === "connect"
        ? core.connectAgent({ agent })
        : core.runAgent({ agent, runId: input.runId });
    try {
      await vi.advanceTimersByTimeAsync(0);
      let channel = channels.mock.results[0]!.value;
      channel.triggerJoin("ok");
      channel.serverPush("ag_ui_event", {
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
        metadata: { cpki_event_id: "started-10" },
      });
      if (mode === "run") {
        const socket = channels.mock.contexts[0];
        if (!(socket instanceof MockSocket))
          throw new Error("Missing original socket");
        for (let attempt = 0; attempt < 5; attempt++)
          socket.triggerError(new Error("transport dropped"));
        await vi.advanceTimersByTimeAsync(0);
        channel = channels.mock.results[1]!.value;
        expect(channel.params.stream_mode).toBe("connect");
        channel.triggerJoin("ok");
      }
      const owner = {
        id: "assistant-weather",
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "weather-call",
            type: "function",
            function: { name: "weather", arguments: "{}" },
          },
        ],
      };
      channel.serverPush("ag_ui_event", {
        type: EventType.TOOL_CALL_START,
        toolCallId: "weather-call",
        toolCallName: "weather",
        parentMessageId: owner.id,
      });
      channel.serverPush("ag_ui_event", {
        type: EventType.TOOL_CALL_END,
        toolCallId: "weather-call",
      });
      channel.serverPush("ag_ui_event", {
        type: EventType.TOOL_CALL_RESULT,
        toolCallId: "weather-call",
        messageId: "weather-result",
        role: "tool",
        content: "72 degrees",
      });
      // A stale server snapshot must not erase a result already delivered in
      // this restore when the connection fails before RUN_FINISHED.
      channel.serverPush("ag_ui_event", {
        type: EventType.MESSAGES_SNAPSHOT,
        messages: [owner],
        metadata: { cpki_event_id: "snapshot-20" },
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(agent.messages).toEqual([owner]);
      channel.serverPush("replay_failed", {
        reason: "history_read_failed",
        retryable: false,
        latestEventId: "snapshot-20",
      });
      await operation;

      expect(agent.messages).toEqual([
        owner,
        {
          id: "weather-result",
          role: "tool",
          toolCallId: "weather-call",
          content: "72 degrees",
        },
      ]);
      expect(onRunFailed).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          error: new AgentHistoryReplayError("history_read_failed"),
        }),
      );
      expect(onError).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          code: "agent_history_replay_failed",
          error: new AgentHistoryReplayError("history_read_failed"),
        }),
      );
      expect(consoleError).toHaveBeenCalledOnce();
      expect(agent.isRunning).toBe(false);
    } finally {
      await agent.detachActiveRun();
      await operation;
      lifecycle.unsubscribe();
      errors.unsubscribe();
      teardown();
    }
  },
);
