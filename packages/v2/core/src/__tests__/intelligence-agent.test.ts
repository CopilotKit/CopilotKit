import { describe, it, expect, beforeEach, vi } from "vitest";
import { EventType, BaseEvent } from "@ag-ui/client";
import { IntelligenceAgent } from "../intelligence-agent";

// ---------------------------------------------------------------------------
// Phoenix mock — must be inside vi.hoisted() so it's available when the
// hoisted vi.mock() factory runs.
// ---------------------------------------------------------------------------

const { MockSocket, MockChannel } = vi.hoisted(() => {
  type ChannelHandler = (payload: any) => void;
  type ReceiveCallback = (resp?: any) => void;

  class MockChannel {
    public topic: string;
    public params: Record<string, any>;
    public pushCalls: Array<{ event: string; payload: any }> = [];
    public leftChannel = false;

    private handlers = new Map<string, ChannelHandler[]>();
    private joinReceiveCallbacks = new Map<string, ReceiveCallback>();

    constructor(topic: string, params: Record<string, any>) {
      this.topic = topic;
      this.params = params;
    }

    on(event: string, handler: ChannelHandler): number {
      const list = this.handlers.get(event) ?? [];
      list.push(handler);
      this.handlers.set(event, list);
      return list.length;
    }

    join() {
      return {
        receive: (status: string, cb: ReceiveCallback) => {
          this.joinReceiveCallbacks.set(status, cb);
          return {
            receive: (s: string, c: ReceiveCallback) => {
              this.joinReceiveCallbacks.set(s, c);
              return {
                receive: (s2: string, c2: ReceiveCallback) => {
                  this.joinReceiveCallbacks.set(s2, c2);
                },
              };
            },
          };
        },
      };
    }

    push(event: string, payload: any) {
      this.pushCalls.push({ event, payload });
    }

    leave() {
      this.leftChannel = true;
    }

    simulateJoinOk(resp?: any) {
      this.joinReceiveCallbacks.get("ok")?.(resp);
    }

    simulateJoinError(resp?: any) {
      this.joinReceiveCallbacks.get("error")?.(resp);
    }

    simulateJoinTimeout() {
      this.joinReceiveCallbacks.get("timeout")?.();
    }

    simulateServerPush(event: string, payload: any) {
      for (const handler of this.handlers.get(event) ?? []) {
        handler(payload);
      }
    }
  }

  class MockSocket {
    public url: string;
    public opts: Record<string, any>;
    public connected = false;
    public disconnected = false;
    public channels: MockChannel[] = [];

    constructor(url: string, opts: Record<string, any>) {
      this.url = url;
      this.opts = opts;
    }

    connect() {
      this.connected = true;
    }

    disconnect() {
      this.disconnected = true;
    }

    channel(topic: string, params: Record<string, any>) {
      const ch = new MockChannel(topic, params);
      this.channels.push(ch);
      return ch;
    }
  }

  return { MockSocket, MockChannel };
});

vi.mock("phoenix", () => ({
  Socket: MockSocket,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createAgent() {
  return new IntelligenceAgent({
    url: "ws://localhost:4000/socket",
    socketParams: { token: "test-token" },
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
function collectEvents(agent: IntelligenceAgent, input = defaultInput) {
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

function getSocket(agent: IntelligenceAgent): MockSocket {
  return (agent as any).socket as MockSocket;
}

function getChannel(agent: IntelligenceAgent): MockChannel {
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

    it("pushes a CUSTOM 'run' event with the full input after join ok", () => {
      const agent = createAgent();
      agent.run(defaultInput).subscribe({ next: () => {}, error: () => {} });

      const channel = getChannel(agent);
      channel.simulateJoinOk();

      const runPush = channel.pushCalls.find(
        (c) => c.event === EventType.CUSTOM && c.payload.name === "run",
      );
      expect(runPush).toBeDefined();
      expect(runPush!.payload).toEqual({
        type: EventType.CUSTOM,
        name: "run",
        value: {
          threadId: "thread-1",
          runId: "run-1",
          messages: [],
          tools: [],
          context: [],
          state: {},
          forwardedProps: {},
        },
      });
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
      channel.simulateJoinOk();

      const textEvent = {
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: "msg-1",
        delta: "hello",
      } as BaseEvent;
      channel.simulateServerPush(EventType.TEXT_MESSAGE_CONTENT, textEvent);

      const toolEvent = {
        type: EventType.TOOL_CALL_START,
        toolCallId: "tc-1",
        toolCallName: "search",
        parentMessageId: "msg-1",
      } as BaseEvent;
      channel.simulateServerPush(EventType.TOOL_CALL_START, toolEvent);

      expect(events).toContainEqual(textEvent);
      expect(events).toContainEqual(toolEvent);
    });
  });

  describe("terminal events", () => {
    it("completes the observable on RUN_FINISHED", async () => {
      const agent = createAgent();
      const promise = collectEvents(agent);

      const channel = getChannel(agent);
      channel.simulateJoinOk();

      const finishedEvent = {
        type: EventType.RUN_FINISHED,
        threadId: "thread-1",
        runId: "run-1",
      } as BaseEvent;
      channel.simulateServerPush(EventType.RUN_FINISHED, finishedEvent);

      const result = await promise;
      expect(result.completed).toBe(true);
      expect(result.error).toBeNull();
      expect(result.events).toContainEqual(finishedEvent);
    });

    it("errors the observable on RUN_ERROR", async () => {
      const agent = createAgent();
      const promise = collectEvents(agent);

      const channel = getChannel(agent);
      channel.simulateJoinOk();

      const errorEvent = {
        type: EventType.RUN_ERROR,
        message: "something went wrong",
      } as BaseEvent;
      channel.simulateServerPush(EventType.RUN_ERROR, errorEvent);

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
      channel.simulateJoinOk();
      channel.simulateServerPush(EventType.RUN_FINISHED, {
        type: EventType.RUN_FINISHED,
        threadId: "thread-1",
        runId: "run-1",
      } as BaseEvent);

      await promise;
      expect(channel.leftChannel).toBe(true);
      expect(socket.disconnected).toBe(true);
    });
  });

  describe("join failures", () => {
    it("emits RUN_ERROR and errors the observable on join error", async () => {
      const agent = createAgent();
      const promise = collectEvents(agent);

      const channel = getChannel(agent);
      channel.simulateJoinError({ reason: "unauthorized" });

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
      channel.simulateJoinTimeout();

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
    it("pushes a CUSTOM 'stop' event and leaves the channel", () => {
      const agent = createAgent();
      agent.run(defaultInput).subscribe({ next: () => {}, error: () => {} });

      const channel = getChannel(agent);
      channel.simulateJoinOk();

      agent.abortRun();

      const stopPush = channel.pushCalls.find(
        (c) => c.event === EventType.CUSTOM && c.payload.name === "stop",
      );
      expect(stopPush).toBeDefined();
      expect(stopPush!.payload).toEqual({
        type: EventType.CUSTOM,
        name: "stop",
        value: {},
      });
      expect(channel.leftChannel).toBe(true);
    });

    it("is a no-op when no run is active", () => {
      const agent = createAgent();
      // Should not throw.
      expect(() => agent.abortRun()).not.toThrow();
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
      channel.simulateJoinOk();

      subscription.unsubscribe();

      expect(channel.leftChannel).toBe(true);
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
