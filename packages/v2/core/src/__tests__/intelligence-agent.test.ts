import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventType, BaseEvent } from "@ag-ui/client";
import { MockSocket, MockChannel } from "./test-utils";

vi.mock("phoenix", () => ({
  Socket: MockSocket,
}));

// Must come after vi.mock so phoenix is mocked when the module is loaded.
const { IntelligenceAgent } = await import("../intelligence-agent");

let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockFetch = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function createAgent() {
  return new IntelligenceAgent({
    url: "ws://localhost:4000/socket",
    runtimeUrl: "http://localhost:4000",
    agentId: "my-agent",
    socketParams: { token: "test-token" },
    headers: { Authorization: "Bearer abc" },
  });
}

const defaultInput = {
  threadId: "thread-1",
  runId: "run-1",
  messages: [],
  tools: [],
  context: [],
  state: {},
  forwardedProps: {},
} as any;

/** Collect events from the observable until it completes or errors. */
function collectEvents(
  agent: InstanceType<typeof IntelligenceAgent>,
  input = defaultInput,
) {
  const events: BaseEvent[] = [];
  let completed = false;
  let error: Error | null = null;

  return new Promise<{
    events: BaseEvent[];
    completed: boolean;
    error: Error | null;
    channel: MockChannel;
    socket: MockSocket;
  }>((resolve) => {
    const subscription = agent.run(input).subscribe({
      next: (event) => events.push(event),
      complete: () => {
        completed = true;
        resolve({
          events,
          completed,
          error,
          channel: getChannel(agent),
          socket: getSocket(agent),
        });
      },
      error: (err) => {
        error = err;
        resolve({
          events,
          completed,
          error,
          channel: getChannel(agent),
          socket: getSocket(agent),
        });
      },
    });
  });
}

function getSocket(agent: InstanceType<typeof IntelligenceAgent>): MockSocket {
  return (agent as any).socket as MockSocket;
}

function getChannel(
  agent: InstanceType<typeof IntelligenceAgent>,
): MockChannel {
  return (agent as any).activeChannel as MockChannel;
}

describe("IntelligenceAgent", () => {
  describe("run kickoff", () => {
    it("connects the socket and joins the channel on subscribe", () => {
      const agent = createAgent();
      agent.run(defaultInput).subscribe({ next: () => {}, error: () => {} });

      const socket = getSocket(agent);
      expect(socket.connected).toBe(true);
      expect(socket.url).toBe("ws://localhost:4000/socket");
      expect(socket.opts.params).toEqual({ token: "test-token" });

      const channel = getChannel(agent);
      expect(channel.topic).toBe("agent:thread-1");
      expect(channel.params).toEqual({ runId: "run-1" });
    });

    it("fires a REST POST to /agent/{agentId}/run after join ok", async () => {
      const agent = createAgent();
      agent.run(defaultInput).subscribe({ next: () => {}, error: () => {} });

      const channel = getChannel(agent);
      channel.triggerJoin("ok");

      // Wait a tick for the fetch to be called
      await Promise.resolve();

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toContain("/agent/my-agent/run");
      expect(options.method).toBe("POST");
      expect(options.headers).toMatchObject({
        "Content-Type": "application/json",
        Authorization: "Bearer abc",
      });
      expect(JSON.parse(options.body)).toEqual({
        threadId: "thread-1",
        runId: "run-1",
        messages: [],
        tools: [],
        context: [],
        state: {},
        forwardedProps: {},
      });
    });

    it("does not push any CUSTOM events to the channel", () => {
      const agent = createAgent();
      agent.run(defaultInput).subscribe({ next: () => {}, error: () => {} });

      const channel = getChannel(agent);
      channel.triggerJoin("ok");

      // No pushes to channel — run is triggered via REST
      expect(channel.pushLog).toHaveLength(0);
    });
  });

  describe("REST run failure", () => {
    it("errors the observable on fetch failure", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const agent = createAgent();
      const promise = collectEvents(agent);

      const channel = getChannel(agent);
      channel.triggerJoin("ok");

      const result = await promise;
      expect(result.completed).toBe(false);
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error!.message).toContain("REST run request failed");
    });
  });

  describe("event relay", () => {
    it("forwards AG-UI events from the server to the subscriber", () => {
      const agent = createAgent();
      const events: BaseEvent[] = [];
      agent
        .run(defaultInput)
        .subscribe({ next: (e) => events.push(e), error: () => {} });

      const channel = getChannel(agent);
      channel.triggerJoin("ok");

      const textEvent = {
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: "msg-1",
        delta: "hello",
      } as BaseEvent;
      channel.serverPush("ag-ui", textEvent);

      const toolEvent = {
        type: EventType.TOOL_CALL_START,
        toolCallId: "tc-1",
        toolCallName: "search",
        parentMessageId: "msg-1",
      } as BaseEvent;
      channel.serverPush("ag-ui", toolEvent);

      expect(events).toContainEqual(textEvent);
      expect(events).toContainEqual(toolEvent);
    });
  });

  describe("terminal events", () => {
    it("completes the observable on RUN_FINISHED", async () => {
      const agent = createAgent();
      const promise = collectEvents(agent);

      const channel = getChannel(agent);
      channel.triggerJoin("ok");

      const finishedEvent = {
        type: EventType.RUN_FINISHED,
        threadId: "thread-1",
        runId: "run-1",
      } as BaseEvent;
      channel.serverPush("ag-ui", finishedEvent);

      const result = await promise;
      expect(result.completed).toBe(true);
      expect(result.error).toBeNull();
      expect(result.events).toContainEqual(finishedEvent);
    });

    it("errors the observable on RUN_ERROR", async () => {
      const agent = createAgent();
      const promise = collectEvents(agent);

      const channel = getChannel(agent);
      channel.triggerJoin("ok");

      const errorEvent = {
        type: EventType.RUN_ERROR,
        message: "something went wrong",
      } as BaseEvent;
      channel.serverPush("ag-ui", errorEvent);

      const result = await promise;
      expect(result.completed).toBe(false);
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error!.message).toBe("something went wrong");
      expect(result.events).toContainEqual(errorEvent);
    });

    it("cleans up socket and channel on RUN_FINISHED", async () => {
      const agent = createAgent();
      const promise = collectEvents(agent);

      const socket = getSocket(agent);
      const channel = getChannel(agent);
      channel.triggerJoin("ok");
      channel.serverPush("ag-ui", {
        type: EventType.RUN_FINISHED,
        threadId: "thread-1",
        runId: "run-1",
      } as BaseEvent);

      await promise;
      expect(channel.left).toBe(true);
      expect(socket.disconnected).toBe(true);
    });
  });

  describe("mid-run disconnect", () => {
    it("does not error the observable on a single channel crash (Phoenix retries)", () => {
      const agent = createAgent();
      let error: Error | null = null;
      agent.run(defaultInput).subscribe({
        next: () => {},
        error: (err) => {
          error = err;
        },
      });

      const channel = getChannel(agent);
      channel.triggerJoin("ok");

      // A single channel error should be a no-op — Phoenix handles rejoin.
      channel.triggerError("server crash");

      expect(error).toBeNull();
    });

    it("does not error the observable on a single socket error (Phoenix retries)", () => {
      const agent = createAgent();
      let error: Error | null = null;
      agent.run(defaultInput).subscribe({
        next: () => {},
        error: (err) => {
          error = err;
        },
      });

      const channel = getChannel(agent);
      channel.triggerJoin("ok");

      const socket = getSocket(agent);
      socket.triggerError(new Error("network failure"));

      // A single socket error should not kill the connection — Phoenix retries.
      expect(error).toBeNull();
    });

    it("errors the observable after MAX_CONSECUTIVE_ERRORS socket errors", async () => {
      const agent = createAgent();
      const promise = collectEvents(agent);

      const socket = getSocket(agent);
      const channel = getChannel(agent);
      channel.triggerJoin("ok");

      // Fire 5 consecutive errors (the threshold)
      for (let i = 0; i < 5; i++) {
        socket.triggerError(new Error("network failure"));
      }

      const result = await promise;
      expect(result.completed).toBe(false);
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error!.message).toContain("5 consecutive errors");
    });

    it("cleans up socket and channel after reaching the error threshold", async () => {
      const agent = createAgent();
      const promise = collectEvents(agent);

      const socket = getSocket(agent);
      const channel = getChannel(agent);
      channel.triggerJoin("ok");

      for (let i = 0; i < 5; i++) {
        socket.triggerError();
      }

      await promise;
      expect(channel.left).toBe(true);
      expect(socket.disconnected).toBe(true);
    });

    it("resets the error counter on successful reconnection", () => {
      const agent = createAgent();
      let error: Error | null = null;
      agent.run(defaultInput).subscribe({
        next: () => {},
        error: (err) => {
          error = err;
        },
      });

      const socket = getSocket(agent);
      const channel = getChannel(agent);
      channel.triggerJoin("ok");

      // 4 errors (just below threshold)
      for (let i = 0; i < 4; i++) {
        socket.triggerError();
      }
      expect(error).toBeNull();

      // Successful reconnect resets counter
      socket.triggerOpen();

      // 4 more errors — still below threshold because counter was reset
      for (let i = 0; i < 4; i++) {
        socket.triggerError();
      }
      expect(error).toBeNull();
    });
  });

  describe("join failures", () => {
    it("errors the observable on join error", async () => {
      const agent = createAgent();
      const promise = collectEvents(agent);

      const channel = getChannel(agent);
      channel.triggerJoin("error", { reason: "unauthorized" });

      const result = await promise;
      expect(result.completed).toBe(false);
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error!.message).toContain("Failed to join channel");
    });

    it("errors the observable on join timeout", async () => {
      const agent = createAgent();
      const promise = collectEvents(agent);

      const channel = getChannel(agent);
      channel.triggerJoin("timeout");

      const result = await promise;
      expect(result.completed).toBe(false);
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error!.message).toBe("Timed out joining channel");
    });
  });

  describe("abortRun", () => {
    it("pushes a CUSTOM stop event to the channel", () => {
      const agent = createAgent();
      agent.run(defaultInput).subscribe({ next: () => {}, error: () => {} });

      const channel = getChannel(agent);
      channel.triggerJoin("ok");

      agent.abortRun();

      const stopPush = channel.pushLog.find(
        (c) =>
          c.payload?.type === EventType.CUSTOM && c.payload?.name === "stop",
      );
      expect(stopPush).toBeDefined();
      expect(stopPush!.payload).toMatchObject({
        type: EventType.CUSTOM,
        name: "stop",
        value: { threadId: "thread-1" },
      });
    });

    it("defers cleanup until the push is acknowledged (ok)", () => {
      const agent = createAgent();
      agent.run(defaultInput).subscribe({ next: () => {}, error: () => {} });

      const channel = getChannel(agent);
      channel.triggerJoin("ok");

      agent.abortRun();

      // Cleanup has NOT happened yet — waiting for push ACK
      expect(channel.left).toBe(false);

      // Server acknowledges the stop push
      const stopEntry = channel.pushLog.find(
        (c) => c.payload?.name === "stop",
      )!;
      stopEntry.push.trigger("ok");

      expect(channel.left).toBe(true);
    });

    it("cleans up on push error reply", () => {
      const agent = createAgent();
      agent.run(defaultInput).subscribe({ next: () => {}, error: () => {} });

      const channel = getChannel(agent);
      channel.triggerJoin("ok");
      agent.abortRun();

      const stopEntry = channel.pushLog.find(
        (c) => c.payload?.name === "stop",
      )!;
      stopEntry.push.trigger("error");

      expect(channel.left).toBe(true);
    });

    it("cleans up on push timeout reply", () => {
      const agent = createAgent();
      agent.run(defaultInput).subscribe({ next: () => {}, error: () => {} });

      const channel = getChannel(agent);
      channel.triggerJoin("ok");
      agent.abortRun();

      const stopEntry = channel.pushLog.find(
        (c) => c.payload?.name === "stop",
      )!;
      stopEntry.push.trigger("timeout");

      expect(channel.left).toBe(true);
    });

    it("cleans up immediately via fallback timer when socket is down", () => {
      vi.useFakeTimers();
      const agent = createAgent();
      agent.run(defaultInput).subscribe({ next: () => {}, error: () => {} });

      const channel = getChannel(agent);
      channel.triggerJoin("ok");
      agent.abortRun();

      // No ACK will arrive (socket is down) — channel still open
      expect(channel.left).toBe(false);

      // Fallback fires after 5 seconds
      vi.advanceTimersByTime(5_000);
      expect(channel.left).toBe(true);

      vi.useRealTimers();
    });

    it("cleans up immediately when no run is active", () => {
      const agent = createAgent();
      // Should not throw and should not push anything
      expect(() => agent.abortRun()).not.toThrow();
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("unsubscribe cleanup", () => {
    it("leaves the channel and disconnects the socket on unsubscribe", () => {
      const agent = createAgent();
      const subscription = agent
        .run(defaultInput)
        .subscribe({ next: () => {}, error: () => {} });

      const socket = getSocket(agent);
      const channel = getChannel(agent);
      channel.triggerJoin("ok");

      subscription.unsubscribe();

      expect(channel.left).toBe(true);
      expect(socket.disconnected).toBe(true);
    });
  });

  describe("credentials forwarding", () => {
    it("forwards credentials on run fetch when configured", async () => {
      const agent = new IntelligenceAgent({
        url: "ws://localhost:4000/socket",
        runtimeUrl: "http://localhost:4000",
        agentId: "my-agent",
        credentials: "include",
      });
      agent.run(defaultInput).subscribe({ next: () => {}, error: () => {} });

      const channel = getChannel(agent);
      channel.triggerJoin("ok");
      await Promise.resolve();

      const [, options] = mockFetch.mock.calls[0];
      expect(options.credentials).toBe("include");
    });

    it("omits credentials when not configured", async () => {
      const agent = createAgent();
      agent.run(defaultInput).subscribe({ next: () => {}, error: () => {} });

      const channel = getChannel(agent);
      channel.triggerJoin("ok");
      await Promise.resolve();

      const [, options] = mockFetch.mock.calls[0];
      expect(options.credentials).toBeUndefined();
    });
  });

  describe("connect", () => {
    /** Access the protected connect() method for testing. */
    function connectAgent(
      agent: InstanceType<typeof IntelligenceAgent>,
      input = defaultInput,
    ) {
      const events: BaseEvent[] = [];
      let completed = false;
      let error: Error | null = null;

      return new Promise<{
        events: BaseEvent[];
        completed: boolean;
        error: Error | null;
        channel: MockChannel;
        socket: MockSocket;
      }>((resolve) => {
        (agent as any).connect(input).subscribe({
          next: (event: BaseEvent) => events.push(event),
          complete: () => {
            completed = true;
            resolve({
              events,
              completed,
              error,
              channel: getChannel(agent),
              socket: getSocket(agent),
            });
          },
          error: (err: Error) => {
            error = err;
            resolve({
              events,
              completed,
              error,
              channel: getChannel(agent),
              socket: getSocket(agent),
            });
          },
        });
      });
    }

    it("joins channel in connect mode and pushes CUSTOM connect event", () => {
      const agent = createAgent();
      (agent as any).connect(defaultInput).subscribe({
        next: () => {},
        error: () => {},
      });

      const channel = getChannel(agent);
      expect(channel.params).toEqual({ mode: "connect" });

      channel.triggerJoin("ok");

      const connectPush = channel.pushLog.find(
        (c) => c.event === EventType.CUSTOM,
      );
      expect(connectPush).toBeDefined();
      expect(connectPush!.payload).toMatchObject({
        type: EventType.CUSTOM,
        name: "connect",
        value: { threadId: "thread-1" },
      });
    });

    it("completes on RUN_FINISHED from server", async () => {
      const agent = createAgent();
      const promise = connectAgent(agent);

      const channel = getChannel(agent);
      channel.triggerJoin("ok");

      channel.serverPush("ag-ui", {
        type: EventType.RUN_FINISHED,
        threadId: "thread-1",
        runId: "run-1",
      } as BaseEvent);

      const result = await promise;
      expect(result.completed).toBe(true);
      expect(result.error).toBeNull();
    });

    it("completes on RUN_ERROR from server", async () => {
      const agent = createAgent();
      const promise = connectAgent(agent);

      const channel = getChannel(agent);
      channel.triggerJoin("ok");

      channel.serverPush("ag-ui", {
        type: EventType.RUN_ERROR,
        message: "something went wrong",
      } as BaseEvent);

      const result = await promise;
      expect(result.completed).toBe(true);
      expect(result.error).toBeNull();
      expect(result.events).toHaveLength(1);
    });

    it("errors the observable on join error", async () => {
      const agent = createAgent();
      const promise = connectAgent(agent);

      const channel = getChannel(agent);
      channel.triggerJoin("error", { reason: "unauthorized" });

      const result = await promise;
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error!.message).toContain("Failed to join channel");
    });

    it("does not error the observable on a single channel crash (Phoenix retries)", () => {
      const agent = createAgent();
      let error: Error | null = null;
      (agent as any).connect(defaultInput).subscribe({
        next: () => {},
        error: (err: Error) => {
          error = err;
        },
      });

      const channel = getChannel(agent);
      channel.triggerJoin("ok");
      channel.triggerError("server crash");

      // Channel errors are handled by Phoenix auto-rejoin — no observer error.
      expect(error).toBeNull();
    });

    it("errors the observable after MAX_CONSECUTIVE_ERRORS socket errors", async () => {
      const agent = createAgent();
      const promise = connectAgent(agent);

      const socket = getSocket(agent);
      const channel = getChannel(agent);
      channel.triggerJoin("ok");

      for (let i = 0; i < 5; i++) {
        socket.triggerError(new Error("network failure"));
      }

      const result = await promise;
      expect(result.completed).toBe(false);
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error!.message).toContain("5 consecutive errors");
    });
  });

  describe("clone", () => {
    it("returns a new IntelligenceAgent with the same config", () => {
      const agent = createAgent();
      const cloned = agent.clone();

      expect(cloned).toBeInstanceOf(IntelligenceAgent);
      expect(cloned).not.toBe(agent);
      expect((cloned as any).config).toEqual((agent as any).config);
    });
  });
});
