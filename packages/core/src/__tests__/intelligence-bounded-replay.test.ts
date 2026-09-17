import { test, expect, vi } from "vitest";
import { EventType } from "@ag-ui/client";
import type { AgentSubscriber } from "@ag-ui/client";
import type { MockSocket } from "./test-utils";

const sockets = vi.hoisted(() => {
  const created: MockSocket[] = [];
  return { created };
});
vi.mock("phoenix", async () => {
  const { MockSocket } = await import("./test-utils");
  return {
    Socket: class extends MockSocket {
      constructor(...args: ConstructorParameters<typeof MockSocket>) {
        super(...args);
        sockets.created.push(this);
      }
    },
  };
});
const { IntelligenceAgent } = await import("../intelligence-agent");

async function setup(subscriber?: AgentSubscriber) {
  const index = sockets.created.length;
  const requests: unknown[] = [];
  const agent = new IntelligenceAgent({
    url: "ws://localhost/client",
    runtimeUrl: "http://localhost",
    agentId: "test",
    replayProtocol: "bounded_v1",
    fetch: async (_url, init) => {
      if (typeof init?.body === "string") requests.push(JSON.parse(init.body));
      return new Response(
        JSON.stringify({
          threadId: "thread-1",
          runId: null,
          joinToken: "test-token",
          realtime: {
            clientUrl: "ws://localhost/client",
            topic: "thread:thread-1",
          },
        }),
      );
    },
  });
  agent.threadId = "thread-1";
  agent.setState({ counter: 0 });
  const result = agent.connectAgent({}, subscriber).then(
    (value) => ({ value, error: undefined }),
    (error) => {
      return { value: undefined, error };
    },
  );
  await vi.waitFor(() =>
    expect(sockets.created[index]?.channels.length).toBe(1),
  );
  const channel = sockets.created[index]?.channels[0];
  if (!channel) throw new Error("Test channel missing");
  channel.triggerJoin("ok", { replay_protocol: "bounded_v1" });
  return {
    agent,
    channel,
    result,
    requests,
    async teardown() {
      await agent.detachActiveRun();
      await result;
    },
  };
}

function batch(sequence = 1) {
  return {
    restore_id: "restore-test",
    sequence,
    token: `token-${sequence}`,
    phase: "history",
    events: [
      {
        type: EventType.STATE_DELTA,
        delta: [{ op: "replace", path: "/counter", value: sequence }],
        metadata: { cpki_event_id: `history-${sequence}` },
      },
    ],
  };
}

test("bounded replay uses the versioned topic and acknowledges only after state application", async () => {
  let finish: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const context = await setup({ onStateDeltaEvent: () => gate });
  try {
    expect(context.channel.topic).toBe("bounded_thread:thread-1");
    context.channel.serverPush("bounded_replay_batch", batch());
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(context.channel.pushLog).toHaveLength(0);
    finish();
    await vi.waitFor(() => expect(context.channel.pushLog).toHaveLength(1));
    expect(context.agent.state).toEqual({ counter: 1 });
    expect(context.channel.pushLog[0]).toMatchObject({
      event: "bounded_replay_ack",
      payload: {
        restore_id: "restore-test",
        sequence: 1,
        token: "token-1",
      },
    });
  } finally {
    finish();
    await context.teardown();
  }
});

test("partial historical delivery rolls back state without committing its cursor", async () => {
  const context = await setup();
  try {
    context.channel.serverPush("bounded_replay_batch", batch());
    await vi.waitFor(() => expect(context.agent.state).toEqual({ counter: 1 }));
    context.channel.serverPush("replay_failed", {
      reason: "spool_corrupt",
      restore_id: "restore-test",
    });
    const result = await context.result;
    expect(result.error).toBeInstanceOf(Error);
    expect(context.agent.state).toEqual({ counter: 0 });
  } finally {
    await context.teardown();
  }
});

test("the history cursor commits only after the explicit commit frame", async () => {
  const context = await setup();
  try {
    context.channel.serverPush("bounded_replay_batch", batch());
    await vi.waitFor(() => expect(context.channel.pushLog).toHaveLength(1));
    context.channel.serverPush("bounded_replay_commit", {
      restore_id: "restore-test",
      token: "commit-token",
      latestEventId: "history-1",
    });
    await vi.waitFor(() => expect(context.channel.pushLog).toHaveLength(2));
    expect(context.channel.pushLog[1]).toMatchObject({
      event: "bounded_replay_commit_ack",
    });
    context.channel.serverPush("replay_complete", {
      latestEventId: "history-1",
    });
    context.channel.serverPush("stream_idle", { latestEventId: "history-1" });
    expect((await context.result).error).toBeUndefined();
    expect(context.agent.state).toEqual({ counter: 1 });
  } finally {
    await context.teardown();
  }
});

test("a failed restore retries from the prior cursor and state", async () => {
  const context = await setup();
  try {
    context.channel.serverPush("bounded_replay_batch", batch());
    await vi.waitFor(() => expect(context.channel.pushLog).toHaveLength(1));
    context.channel.serverPush("replay_failed", { reason: "spool_corrupt" });
    await context.result;
    const index = sockets.created.length;
    const retry = context.agent.connectAgent().catch((error: unknown) => error);
    await vi.waitFor(() =>
      expect(sockets.created[index]?.channels.length).toBe(1),
    );
    const channel = sockets.created[index]?.channels[0];
    if (!channel) throw new Error("Retry channel missing");
    expect(channel.params.last_seen_event_id).toBeNull();
    expect(context.agent.state).toEqual({ counter: 0 });
    await context.agent.detachActiveRun();
    await retry;
  } finally {
    await context.teardown();
  }
});

test("live events advance the cursor after application and stale controls cannot move it backwards", async () => {
  const context = await setup();
  try {
    context.channel.serverPush("bounded_replay_batch", batch());
    await vi.waitFor(() => expect(context.channel.pushLog).toHaveLength(1));
    context.channel.serverPush("bounded_replay_commit", {
      restore_id: "restore-test",
      token: "commit-token",
      latestEventId: "history-1",
    });
    await vi.waitFor(() => expect(context.channel.pushLog).toHaveLength(2));
    context.channel.serverPush("bounded_replay_batch", {
      ...batch(2),
      phase: "live",
    });
    await vi.waitFor(() => expect(context.channel.pushLog).toHaveLength(3));
    context.channel.serverPush("replay_complete", {
      latestEventId: "history-1",
    });
    context.channel.serverPush("stream_idle", { latestEventId: "history-1" });
    expect((await context.result).error).toBeUndefined();
    const index = sockets.created.length;
    const retry = context.agent.connectAgent().catch((error: unknown) => error);
    await vi.waitFor(() =>
      expect(sockets.created[index]?.channels.length).toBe(1),
    );
    const channel = sockets.created[index]?.channels[0];
    if (!channel) throw new Error("Retry channel missing");
    expect(channel.params.last_seen_event_id).toBe("history-2");
    expect(context.agent.state).toEqual({ counter: 2 });
    await context.agent.detachActiveRun();
    await retry;
  } finally {
    await context.teardown();
  }
});

test("acknowledgements wait for asynchronous state subscribers", async () => {
  let finish: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const context = await setup({ onStateChanged: () => gate });
  try {
    context.channel.serverPush("bounded_replay_batch", batch());
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(context.channel.pushLog).toHaveLength(0);
    finish();
    await vi.waitFor(() => expect(context.channel.pushLog).toHaveLength(1));
  } finally {
    finish();
    await context.teardown();
  }
});
