import { expect, test, vi } from "vitest";
import { EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import { MockSocket } from "./test-utils";

vi.mock("phoenix", () => ({ Socket: MockSocket }));

const { IntelligenceAgent } = await import("../intelligence-agent");
const { AgentHistoryReplayError, ProxiedCopilotRuntimeAgent } =
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
