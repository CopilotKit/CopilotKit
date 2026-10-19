import { expect, test, vi } from "vitest";
import { EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import { MockSocket } from "./test-utils";

vi.mock("phoenix", () => ({ Socket: MockSocket }));

const { IntelligenceAgent } = await import("../intelligence-agent");
const { AgentHistoryReplayError } = await import("../index");

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
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  };
  return { agent, channels, disconnect, fetch, input, teardown };
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
