import { AbstractAgent, EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import { Observable, Subject } from "rxjs";
import { WebSocket, WebSocketServer } from "ws";
import { expect, test, vi } from "vitest";
import { IntelligenceAgentRunner } from "../intelligence";
import { CopilotRuntime } from "../../core/runtime";
import { createCopilotRuntimeHandler } from "../../core/fetch-handler";

type Frame = [string | null, string, string, string, Record<string, unknown>];

/** Keeps producing until the test ends it, like an adapter that ignores abort. */
class ControlledAgent extends AbstractAgent {
  readonly output = new Subject<BaseEvent>();
  readonly abortRun = vi.fn();
  runCount = 0;

  run(input: RunAgentInput): Observable<BaseEvent> {
    this.runCount++;
    return new Observable((subscriber) => {
      subscriber.next({
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
      });
      return this.output.subscribe(subscriber);
    });
  }
}

/** Acknowledges a Phoenix request using the same reference and topic. */
function reply(
  socket: WebSocket,
  frame: Frame,
  response: Record<string, unknown> = {},
) {
  socket.send(
    JSON.stringify([
      frame[0],
      frame[1],
      frame[2],
      "phx_reply",
      { status: "ok", response },
    ]),
  );
}

/** Exercises the real Phoenix client against a controllable gateway transport. */
async function setup(batch = false) {
  // Node 20 does not expose a global WebSocket. Keep Node 22+ on its native
  // transport and supply the same protocol transport for the older CI lane.
  const needsWebSocket = typeof globalThis.WebSocket === "undefined";
  if (needsWebSocket) vi.stubGlobal("WebSocket", WebSocket);
  const server = new WebSocketServer({ port: 0 });
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (typeof address !== "object" || address === null)
    throw new Error("Missing test server address");
  const events: BaseEvent[] = [];
  const pending: Array<{
    socket: WebSocket;
    frame: Frame;
    events: BaseEvent[];
  }> = [];
  const locks = new Map<string, string>();
  const errors: unknown[] = [];
  const subscriptions: Array<{ unsubscribe(): void }> = [];
  const agents: ControlledAgent[] = [];
  const runner = new IntelligenceAgentRunner({
    url: `ws://127.0.0.1:${address.port}/runner`,
  });

  server.on("connection", (socket) => {
    socket.on("message", (data) => {
      const frame: Frame = JSON.parse(data.toString());
      if (frame[3] === "phx_join") {
        reply(
          socket,
          frame,
          batch ? { capabilities: ["runner_event_batch_v1"] } : {},
        );
      } else if (frame[3] === "event" || frame[3] === "events") {
        const received = (
          frame[3] === "events" ? frame[4].events : [frame[4]]
        ) as BaseEvent[];
        pending.push({ socket, frame, events: received });
      } else {
        reply(socket, frame);
      }
    });
  });

  /** Models atomic terminal acceptance: only the exact run can release its lock. */
  function acceptPending() {
    for (const item of pending.splice(0)) {
      for (const event of item.events) {
        events.push(event);
        if (
          event.type === EventType.RUN_FINISHED ||
          event.type === EventType.RUN_ERROR
        ) {
          const owner = event as BaseEvent & {
            threadId: string;
            runId: string;
          };
          if (locks.get(owner.threadId) === owner.runId)
            locks.delete(owner.threadId);
        }
      }
      reply(item.socket, item.frame);
    }
  }

  /** Starts a run only when the modeled hosted lock is available. */
  function start(runId = "run-1") {
    if (locks.has("thread-1")) throw new Error("THREAD_LOCK_FAILED");
    const agent = new ControlledAgent();
    agents.push(agent);
    locks.set("thread-1", runId);
    const input: RunAgentInput = {
      threadId: "thread-1",
      runId,
      messages: [],
      tools: [],
      context: [],
      state: {},
      forwardedProps: {},
    };
    subscriptions.push(
      runner
        .run({ threadId: input.threadId, agent, input })
        .subscribe({ error: (error) => errors.push(error) }),
    );
    return agent;
  }

  /** Closes test-owned streams, sockets, timers, and server listeners. */
  async function teardown() {
    subscriptions.forEach((subscription) => subscription.unsubscribe());
    agents.forEach((agent) => agent.output.complete());
    server.clients.forEach((socket) => socket.terminate());
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    if (needsWebSocket) vi.unstubAllGlobals();
  }

  return {
    runner,
    start,
    pending,
    events,
    locks,
    errors,
    acceptPending,
    teardown,
  };
}

for (const batch of [false, true]) {
  test(`Stop waits for terminal acceptance and permits immediate resend (${batch ? "batch" : "legacy"})`, async () => {
    const fixture = await setup(batch);
    try {
      const agent = fixture.start();
      await vi.waitFor(() => expect(fixture.pending.length).toBeGreaterThan(0));
      fixture.acceptPending();
      await vi.waitFor(() => expect(agent.isRunning).toBe(true));
      let stopResolved = false;

      const stopping = fixture.runner
        .stop({ threadId: "thread-1" })
        .then((result) => {
          stopResolved = true;
          return result;
        });
      await vi.waitFor(() =>
        expect(
          fixture.pending.some((item) =>
            item.events.some((event) => event.type === EventType.RUN_FINISHED),
          ),
        ).toBe(true),
      );

      expect(stopResolved).toBe(false);
      expect(fixture.locks.get("thread-1")).toBe("run-1");
      expect(agent.abortRun).toHaveBeenCalledOnce();
      fixture.acceptPending();
      expect(await stopping).toBe(true);
      expect(await fixture.runner.isRunning({ threadId: "thread-1" })).toBe(
        false,
      );
      expect(fixture.locks.has("thread-1")).toBe(false);
      expect(() => fixture.start("run-2")).not.toThrow();
      expect(fixture.errors).toEqual([]);
    } finally {
      await fixture.teardown();
    }
  });
}

test("Stop detaches the local AG-UI subscription when abort does nothing", async () => {
  const fixture = await setup();
  try {
    const agent = fixture.start();
    await vi.waitFor(() => expect(fixture.pending.length).toBeGreaterThan(0));
    fixture.acceptPending();
    expect(agent.output.observed).toBe(true);

    const stopping = fixture.runner
      .stop({ threadId: "thread-1" })
      .catch((error) => error);
    await vi.waitFor(() => expect(agent.output.observed).toBe(false));
    await vi.waitFor(() => expect(fixture.pending.length).toBeGreaterThan(0));
    fixture.acceptPending();

    expect(await stopping).toBe(true);
  } finally {
    await fixture.teardown();
  }
});

for (const abortThrows of [false, true]) {
  test(`Stop fences late events from older agents without detachActiveRun (abort throws: ${abortThrows})`, async () => {
    const fixture = await setup();
    try {
      const agent = fixture.start();
      Object.defineProperty(agent, "detachActiveRun", { value: undefined });
      if (abortThrows)
        agent.abortRun.mockImplementation(() => {
          throw new Error("Adapter cannot abort");
        });
      await vi.waitFor(() => expect(fixture.pending.length).toBeGreaterThan(0));
      fixture.acceptPending();

      const stopping = fixture.runner
        .stop({ threadId: "thread-1", runId: "run-1" })
        .catch((error) => error);
      agent.output.next({
        type: EventType.CUSTOM,
        name: "late",
        value: "discard",
      });
      await vi.waitFor(() => expect(fixture.pending.length).toBeGreaterThan(0));
      fixture.acceptPending();
      expect(await stopping).toBe(true);
      const replacement = fixture.start("run-2");
      await vi.waitFor(() => expect(replacement.runCount).toBe(1));
      fixture.acceptPending();
      agent.output.next({
        type: EventType.CUSTOM,
        name: "late",
        value: "discard again",
      });
      agent.output.error(new Error("Late producer rejection"));

      expect(
        await fixture.runner.stop({ threadId: "thread-1", runId: "run-1" }),
      ).toBe(false);
      expect(replacement.abortRun).not.toHaveBeenCalled();
      expect(fixture.locks.get("thread-1")).toBe("run-2");
      expect(fixture.events.map((event) => event.type)).not.toContain(
        EventType.CUSTOM,
      );
      expect(
        fixture.events.filter((event) => event.type === EventType.RUN_FINISHED),
      ).toHaveLength(1);
      expect(fixture.errors).toEqual([]);
    } finally {
      await fixture.teardown();
    }
  });
}

test("Stop closes partial text and tool calls before its single terminal event", async () => {
  const fixture = await setup(true);
  try {
    const agent = fixture.start();
    await vi.waitFor(() => expect(fixture.pending.length).toBeGreaterThan(0));
    fixture.acceptPending();
    agent.output.next({
      type: EventType.TEXT_MESSAGE_START,
      messageId: "message-1",
      role: "assistant",
    });
    agent.output.next({
      type: EventType.TEXT_MESSAGE_CONTENT,
      messageId: "message-1",
      delta: "partial",
    });
    agent.output.next({
      type: EventType.TOOL_CALL_START,
      toolCallId: "tool-1",
      toolCallName: "lookup",
    });
    agent.output.next({
      type: EventType.TOOL_CALL_ARGS,
      toolCallId: "tool-1",
      delta: "{}",
    });
    await vi.waitFor(() =>
      expect(
        fixture.pending
          .flatMap((item) => item.events)
          .some((event) => event.type === EventType.TOOL_CALL_ARGS),
      ).toBe(true),
    );
    fixture.acceptPending();

    const stopping = fixture.runner
      .stop({ threadId: "thread-1" })
      .catch((error) => error);
    expect(await fixture.runner.stop({ threadId: "thread-1" })).toBe(false);
    await vi.waitFor(() => expect(fixture.pending.length).toBeGreaterThan(0));
    fixture.acceptPending();

    expect(await stopping).toBe(true);
    expect(fixture.events.map((event) => event.type)).toEqual([
      EventType.RUN_STARTED,
      EventType.TEXT_MESSAGE_START,
      EventType.TEXT_MESSAGE_CONTENT,
      EventType.TOOL_CALL_START,
      EventType.TOOL_CALL_ARGS,
      EventType.TEXT_MESSAGE_END,
      EventType.TOOL_CALL_END,
      EventType.TOOL_CALL_RESULT,
      EventType.RUN_FINISHED,
    ]);
    expect(fixture.events.at(-1)).toMatchObject({
      threadId: "thread-1",
      runId: "run-1",
    });
  } finally {
    await fixture.teardown();
  }
});

test("Stop before channel join never starts the agent and still delivers a terminal", async () => {
  const fixture = await setup();
  try {
    const agent = fixture.start();

    const stopping = fixture.runner
      .stop({ threadId: "thread-1" })
      .catch((error) => error);
    await vi.waitFor(() => expect(fixture.pending.length).toBeGreaterThan(0));
    fixture.acceptPending();
    await vi.waitFor(() => expect(fixture.pending.length).toBeGreaterThan(0));
    fixture.acceptPending();

    expect(await stopping).toBe(true);
    expect(agent.runCount).toBe(0);
    expect(fixture.events.map((event) => event.type)).toEqual([
      EventType.RUN_STARTED,
      EventType.RUN_FINISHED,
    ]);
  } finally {
    await fixture.teardown();
  }
});

test("Stop does not report success if terminal delivery is permanently rejected", async () => {
  const fixture = await setup();
  try {
    fixture.start();
    await vi.waitFor(() => expect(fixture.pending.length).toBeGreaterThan(0));
    fixture.acceptPending();

    const stopping = fixture.runner
      .stop({ threadId: "thread-1" })
      .catch((error) => error);
    await vi.waitFor(() => expect(fixture.pending.length).toBeGreaterThan(0));
    const item = fixture.pending.shift();
    if (!item) throw new Error("Missing terminal request");
    item.socket.send(
      JSON.stringify([
        item.frame[0],
        item.frame[1],
        item.frame[2],
        "phx_reply",
        {
          status: "error",
          response: { reason: "active_lock_mismatch", retryable: false },
        },
      ]),
    );

    expect(await stopping).toBeInstanceOf(Error);
    expect(fixture.locks.get("thread-1")).toBe("run-1");
    expect(fixture.errors).toHaveLength(1);
    expect(fixture.events.map((event) => event.type)).toEqual([
      EventType.RUN_STARTED,
    ]);
  } finally {
    await fixture.teardown();
  }
});

test("Stop rejects after the durability deadline instead of acknowledging an unreleased lock", async () => {
  const fixture = await setup();
  try {
    fixture.start();
    await vi.waitFor(() => expect(fixture.pending.length).toBeGreaterThan(0));
    fixture.acceptPending();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

    const stopping = fixture.runner
      .stop({ threadId: "thread-1" })
      .catch((error) => error);
    await vi.advanceTimersByTimeAsync(60_000);

    expect(await stopping).toBeInstanceOf(Error);
    expect(fixture.locks.get("thread-1")).toBe("run-1");
    expect(await fixture.runner.isRunning({ threadId: "thread-1" })).toBe(
      false,
    );
    expect(fixture.errors).toHaveLength(1);
  } finally {
    vi.useRealTimers();
    await fixture.teardown();
  }
});

for (const mode of ["multi-route", "single-route"] as const) {
  test(`The ${mode} Stop endpoint preserves its response and waits for lock release`, async () => {
    const fixture = await setup();
    try {
      const agent = fixture.start();
      const runtime = new CopilotRuntime({
        agents: { test: agent },
        runner: fixture.runner,
      });
      const handler = createCopilotRuntimeHandler({
        runtime,
        mode,
        activateChannels: false,
      });
      await vi.waitFor(() => expect(fixture.pending.length).toBeGreaterThan(0));
      fixture.acceptPending();
      let responded = false;
      const request =
        mode === "multi-route"
          ? new Request("http://runtime/agent/test/stop/thread-1", {
              method: "POST",
            })
          : new Request("http://runtime", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                method: "agent/stop",
                params: { agentId: "test", threadId: "thread-1" },
              }),
            });

      const stopping = handler(request).then((response) => {
        responded = true;
        return response;
      });
      await vi.waitFor(() => expect(fixture.pending.length).toBeGreaterThan(0));
      expect(responded).toBe(false);
      fixture.acceptPending();
      const response = await stopping;

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        stopped: true,
        interrupt: {
          type: EventType.RUN_ERROR,
          message: "Run stopped by user",
          code: "STOPPED",
        },
      });
      expect(fixture.locks.has("thread-1")).toBe(false);
      expect(() => fixture.start("run-2")).not.toThrow();
    } finally {
      await fixture.teardown();
    }
  });
}
