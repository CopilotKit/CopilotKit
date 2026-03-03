import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventType, BaseEvent } from "@ag-ui/client";
import { MockSocket, MockChannel } from "./test-utils";

// ---------------------------------------------------------------------------
// Phoenix mock
// ---------------------------------------------------------------------------

vi.mock("phoenix", () => ({
  Socket: MockSocket,
}));

// Must come after vi.mock so phoenix is mocked when the module is loaded.
const { IntelligenceAgent } = await import("../intelligence-agent");

// ---------------------------------------------------------------------------
// Fetch mock
// ---------------------------------------------------------------------------

let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockFetch = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

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
      expect(url).toBe("http://localhost:4000/agent/my-agent/run");
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
    it("emits RUN_ERROR with code REST_RUN_ERROR on fetch failure", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const agent = createAgent();
      const promise = collectEvents(agent);

      const channel = getChannel(agent);
      channel.triggerJoin("ok");

      const result = await promise;
      expect(result.completed).toBe(false);
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error!.message).toContain("REST run request failed");

      const errorEvent = result.events.find(
        (e) => e.type === EventType.RUN_ERROR,
      ) as BaseEvent & { code?: string };
      expect(errorEvent).toBeDefined();
      expect(errorEvent.code).toBe("REST_RUN_ERROR");
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

  describe("join failures", () => {
    it("emits RUN_ERROR and errors the observable on join error", async () => {
      const agent = createAgent();
      const promise = collectEvents(agent);

      const channel = getChannel(agent);
      channel.triggerJoin("error", { reason: "unauthorized" });

      const result = await promise;
      expect(result.completed).toBe(false);
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error!.message).toContain("Failed to join channel");

      const errorEvent = result.events.find(
        (e) => e.type === EventType.RUN_ERROR,
      ) as BaseEvent & { code?: string };
      expect(errorEvent).toBeDefined();
      expect(errorEvent.code).toBe("CHANNEL_JOIN_ERROR");
    });

    it("emits RUN_ERROR and errors the observable on join timeout", async () => {
      const agent = createAgent();
      const promise = collectEvents(agent);

      const channel = getChannel(agent);
      channel.triggerJoin("timeout");

      const result = await promise;
      expect(result.completed).toBe(false);
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error!.message).toBe("Timed out joining channel");

      const errorEvent = result.events.find(
        (e) => e.type === EventType.RUN_ERROR,
      ) as BaseEvent & { code?: string };
      expect(errorEvent).toBeDefined();
      expect(errorEvent.code).toBe("CHANNEL_JOIN_TIMEOUT");
    });
  });

  describe("abortRun", () => {
    it("fires a REST POST to /agent/{agentId}/stop/{threadId} and cleans up", async () => {
      const agent = createAgent();
      agent.run(defaultInput).subscribe({ next: () => {}, error: () => {} });

      const channel = getChannel(agent);
      channel.triggerJoin("ok");

      // Reset fetch mock to only track abort calls
      mockFetch.mockClear();
      mockFetch.mockResolvedValue({ ok: true });

      agent.abortRun();

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toBe("http://localhost:4000/agent/my-agent/stop/thread-1");
      expect(options.method).toBe("POST");
      expect(options.headers).toMatchObject({
        "Content-Type": "application/json",
        Authorization: "Bearer abc",
      });

      // Channel should be cleaned up
      expect(channel.left).toBe(true);
    });

    it("does not push any CUSTOM events to the channel", () => {
      const agent = createAgent();
      agent.run(defaultInput).subscribe({ next: () => {}, error: () => {} });

      const channel = getChannel(agent);
      channel.triggerJoin("ok");

      // Clear the push log (run may have pushed something)
      channel.pushLog.length = 0;

      agent.abortRun();

      // No CUSTOM stop pushes
      const stopPush = channel.pushLog.find(
        (c) => c.event === EventType.CUSTOM && c.payload?.name === "stop",
      );
      expect(stopPush).toBeUndefined();
    });

    it("is a no-op when no run is active", () => {
      const agent = createAgent();
      // Should not throw.
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
