import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import { EventType } from "@ag-ui/client";
import type { Observable } from "rxjs";
import { RUNTIME_MODE_INTELLIGENCE } from "@copilotkit/shared";
import type { MockChannel } from "./test-utils";
import { MockSocket } from "./test-utils";

vi.mock("phoenix", () => ({
  Socket: MockSocket,
}));

// Must come after vi.mock so phoenix is mocked when the module is loaded.
const { IntelligenceAgent } = await import("../intelligence-agent");
const { ProxiedCopilotRuntimeAgent } = await import("../agent");
type IntelligenceAgentInstance = InstanceType<typeof IntelligenceAgent>;

let mockFetch: ReturnType<typeof vi.fn>;

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response);
}

function emptyResponse(status = 204) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    statusText: "No Content",
    json: () => Promise.resolve(null),
    text: () => Promise.resolve(""),
  } as Response);
}

async function flushAsyncWork() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  if (vi.isFakeTimers()) {
    await vi.runOnlyPendingTimersAsync();
  } else {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  await Promise.resolve();
}

async function waitForConnection(
  agent: IntelligenceAgentInstance,
  attempts = 5,
) {
  for (let index = 0; index < attempts; index += 1) {
    await flushAsyncWork();
    if (getSocket(agent) && getChannel(agent)) {
      return;
    }
  }
}

beforeEach(() => {
  mockFetch = vi.fn().mockResolvedValue(jsonResponse({ joinToken: "jt-123" }));
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function createAgent() {
  return new IntelligenceAgent({
    url: "ws://localhost:4000/client",
    runtimeUrl: "http://localhost:4000",
    agentId: "my-agent",
    socketParams: { token: "test-token" },
    headers: { Authorization: "Bearer abc" },
  });
}

const defaultInput: RunAgentInput = {
  threadId: "thread-1",
  runId: "run-1",
  messages: [],
  tools: [],
  context: [],
  state: {},
  forwardedProps: {},
};

interface IntelligenceAgentTestAccess {
  activeChannel: MockChannel | null;
  canonicalRunId: string | null;
  config: unknown;
  connect(input: RunAgentInput): Observable<BaseEvent>;
  socket: MockSocket | null;
  threadId: string | undefined;
}

function getAgentTestAccess(
  agent: IntelligenceAgentInstance,
): IntelligenceAgentTestAccess {
  return agent as unknown as IntelligenceAgentTestAccess;
}

/** Collect events from the observable until it completes or errors. */
function collectEvents(agent: IntelligenceAgentInstance, input = defaultInput) {
  const events: BaseEvent[] = [];
  let completed = false;
  let error: Error | null = null;

  return new Promise<{
    events: BaseEvent[];
    completed: boolean;
    error: Error | null;
    channel: MockChannel | null;
    socket: MockSocket | null;
  }>((resolve) => {
    agent.run(input).subscribe({
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

function getSocket(agent: IntelligenceAgentInstance): MockSocket | null {
  return getAgentTestAccess(agent).socket;
}

function getChannel(agent: IntelligenceAgentInstance): MockChannel | null {
  return getAgentTestAccess(agent).activeChannel;
}

function connectWithTestAccess(
  agent: IntelligenceAgentInstance,
  input = defaultInput,
) {
  return getAgentTestAccess(agent).connect(input);
}

function setThreadIdForTest(
  agent: IntelligenceAgentInstance,
  threadId: string,
): void {
  getAgentTestAccess(agent).threadId = threadId;
}

function getCanonicalRunIdForTest(
  agent: IntelligenceAgentInstance,
): string | null {
  return getAgentTestAccess(agent).canonicalRunId;
}

function getConfigForTest(agent: IntelligenceAgentInstance): unknown {
  return getAgentTestAccess(agent).config;
}

describe("IntelligenceAgent", () => {
  describe("run kickoff", () => {
    it("fetches joinToken before connecting the socket", async () => {
      let resolveFetch: ((value: Response) => void) | null = null;
      mockFetch.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
      );

      const agent = createAgent();
      agent.run(defaultInput).subscribe({ next: () => {}, error: () => {} });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(getSocket(agent)).toBeNull();
      expect(getChannel(agent)).toBeNull();

      resolveFetch!(await jsonResponse({ joinToken: "jt-delayed" }));
      await flushAsyncWork();

      const socket = getSocket(agent)!;
      expect(socket.connected).toBe(true);
      expect(socket.url).toBe("ws://localhost:4000/client");
      expect(socket.opts.params).toEqual({
        token: "test-token",
        join_token: "jt-delayed",
      });

      const channel = getChannel(agent)!;
      expect(channel.topic).toBe("thread:thread-1");
      expect(channel.params).toEqual({
        stream_mode: "run",
        run_id: "run-1",
      });
    });

    it("fires a REST POST to /agent/{agentId}/run on subscribe", async () => {
      const agent = createAgent();
      agent.run(defaultInput).subscribe({ next: () => {}, error: () => {} });
      await flushAsyncWork();

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

    it("does not push any events to the channel during join", async () => {
      const agent = createAgent();
      agent.run(defaultInput).subscribe({ next: () => {}, error: () => {} });
      await flushAsyncWork();

      const channel = getChannel(agent)!;
      channel.triggerJoin("ok");

      expect(channel.pushLog).toHaveLength(0);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("joins with a null replay cursor when the thread has no prior events", async () => {
      const agent = createAgent();
      agent.run(defaultInput).subscribe({ next: () => {}, error: () => {} });
      await flushAsyncWork();

      const channel = getChannel(agent)!;

      expect(channel.params).toEqual({
        stream_mode: "run",
        run_id: "run-1",
      });
    });
  });

  describe("REST run failure", () => {
    it("errors the observable on fetch failure without creating a socket", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const agent = createAgent();
      const result = await collectEvents(agent);

      expect(result.completed).toBe(false);
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error!.message).toContain("REST run request failed");
      expect(result.socket).toBeNull();
      expect(result.channel).toBeNull();
    });

    it("throws AgentThreadLockedError on 409 response", async () => {
      const { AgentThreadLockedError } = await import("../intelligence-agent");
      mockFetch.mockResolvedValueOnce(
        Promise.resolve({
          ok: false,
          status: 409,
          statusText: "Conflict",
          json: () => Promise.resolve({ error: "Thread lock denied" }),
          text: () => Promise.resolve('{"error":"Thread lock denied"}'),
        } as Response),
      );

      const agent = createAgent();
      const result = await collectEvents(agent);

      expect(result.completed).toBe(false);
      expect(result.error).toBeInstanceOf(AgentThreadLockedError);
      expect(result.error!.message).toContain("thread-1");
      expect(result.error!.message).toContain("locked");
      expect(result.socket).toBeNull();
      expect(result.channel).toBeNull();
    });
  });

  describe("event relay", () => {
    it("forwards AG-UI events from the server to the subscriber", async () => {
      const agent = createAgent();
      const events: BaseEvent[] = [];
      agent
        .run(defaultInput)
        .subscribe({ next: (e) => events.push(e), error: () => {} });
      await flushAsyncWork();

      const channel = getChannel(agent)!;
      channel.triggerJoin("ok");

      const textEvent = {
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: "msg-1",
        delta: "hello",
      } as BaseEvent;
      channel.serverPush("ag_ui_event", textEvent);

      const toolEvent = {
        type: EventType.TOOL_CALL_START,
        toolCallId: "tc-1",
        toolCallName: "search",
        parentMessageId: "msg-1",
      } as BaseEvent;
      channel.serverPush("ag_ui_event", toolEvent);

      expect(events).toContainEqual(textEvent);
      expect(events).toContainEqual(toolEvent);
    });
  });

  describe("terminal events", () => {
    it("completes the observable on RUN_FINISHED", async () => {
      const agent = createAgent();
      const promise = collectEvents(agent);
      await waitForConnection(agent);

      const channel = getChannel(agent)!;
      channel.triggerJoin("ok");

      const finishedEvent = {
        type: EventType.RUN_FINISHED,
        threadId: "thread-1",
        runId: "run-1",
      } as BaseEvent;
      channel.serverPush("ag_ui_event", finishedEvent);

      const result = await promise;
      expect(result.completed).toBe(true);
      expect(result.error).toBeNull();
      expect(result.events).toContainEqual(finishedEvent);
    });

    it("errors the observable on RUN_ERROR", async () => {
      const agent = createAgent();
      const promise = collectEvents(agent);
      await waitForConnection(agent);

      const channel = getChannel(agent)!;
      channel.triggerJoin("ok");

      const errorEvent = {
        type: EventType.RUN_ERROR,
        message: "something went wrong",
      } as BaseEvent;
      channel.serverPush("ag_ui_event", errorEvent);

      const result = await promise;
      expect(result.completed).toBe(false);
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error!.message).toBe("something went wrong");
      expect(result.events).toContainEqual(errorEvent);
    });

    it("cleans up socket and channel on RUN_FINISHED", async () => {
      const agent = createAgent();
      const promise = collectEvents(agent);
      await flushAsyncWork();

      const socket = getSocket(agent)!;
      const channel = getChannel(agent)!;
      channel.triggerJoin("ok");
      channel.serverPush("ag_ui_event", {
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
    it("does not error the observable on a single channel crash (Phoenix retries)", async () => {
      const agent = createAgent();
      let error: Error | null = null;
      agent.run(defaultInput).subscribe({
        next: () => {},
        error: (err) => {
          error = err;
        },
      });
      await flushAsyncWork();

      await waitForConnection(agent);
      const channel = getChannel(agent)!;
      channel.triggerJoin("ok");
      channel.triggerError("server crash");

      expect(error).toBeNull();
    });

    it("does not error the observable on a single socket error (Phoenix retries)", async () => {
      const agent = createAgent();
      let error: Error | null = null;
      agent.run(defaultInput).subscribe({
        next: () => {},
        error: (err) => {
          error = err;
        },
      });
      await waitForConnection(agent);

      getChannel(agent)!.triggerJoin("ok");
      getSocket(agent)!.triggerError(new Error("network failure"));

      expect(error).toBeNull();
    });

    it("errors the observable after MAX_CONSECUTIVE_ERRORS socket errors", async () => {
      const agent = createAgent();
      const promise = collectEvents(agent);
      await waitForConnection(agent);

      getChannel(agent)!.triggerJoin("ok");

      for (let i = 0; i < 5; i++) {
        getSocket(agent)!.triggerError(new Error("network failure"));
      }

      const result = await promise;
      expect(result.completed).toBe(false);
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error!.message).toContain("5 consecutive errors");
    });

    it("cleans up socket and channel after reaching the error threshold", async () => {
      const agent = createAgent();
      const promise = collectEvents(agent);
      await flushAsyncWork();

      const socket = getSocket(agent)!;
      const channel = getChannel(agent)!;
      channel.triggerJoin("ok");

      for (let i = 0; i < 5; i++) {
        socket.triggerError();
      }

      await promise;
      expect(channel.left).toBe(true);
      expect(socket.disconnected).toBe(true);
    });

    it("resets the error counter on successful reconnection", async () => {
      const agent = createAgent();
      let error: Error | null = null;
      agent.run(defaultInput).subscribe({
        next: () => {},
        error: (err) => {
          error = err;
        },
      });
      await flushAsyncWork();

      const socket = getSocket(agent)!;
      getChannel(agent)!.triggerJoin("ok");

      for (let i = 0; i < 4; i++) {
        socket.triggerError();
      }
      expect(error).toBeNull();

      socket.triggerOpen();

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
      await flushAsyncWork();

      getChannel(agent)!.triggerJoin("error", { reason: "unauthorized" });

      const result = await promise;
      expect(result.completed).toBe(false);
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error!.message).toContain("Failed to join channel");
    });

    it("errors the observable on join timeout", async () => {
      const agent = createAgent();
      const promise = collectEvents(agent);
      await flushAsyncWork();

      getChannel(agent)!.triggerJoin("timeout");

      const result = await promise;
      expect(result.completed).toBe(false);
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error!.message).toBe("Timed out joining channel");
    });
  });

  describe("abortRun", () => {
    it("pushes stop_run with the current run id", async () => {
      const agent = createAgent();
      agent.run(defaultInput).subscribe({ next: () => {}, error: () => {} });
      await flushAsyncWork();

      const channel = getChannel(agent)!;
      channel.triggerJoin("ok");

      agent.abortRun();

      const stopPush = channel.pushLog.find((c) => c.event === "stop_run");
      expect(stopPush).toBeDefined();
      expect(stopPush!.payload).toEqual({ run_id: "run-1" });
    });

    it("defers cleanup until the push is acknowledged (ok)", async () => {
      const agent = createAgent();
      agent.run(defaultInput).subscribe({ next: () => {}, error: () => {} });
      await flushAsyncWork();

      const channel = getChannel(agent)!;
      channel.triggerJoin("ok");
      agent.abortRun();

      expect(channel.left).toBe(false);

      const stopEntry = channel.pushLog.find((c) => c.event === "stop_run")!;
      stopEntry.push.trigger("ok");

      expect(channel.left).toBe(true);
    });

    it("cleans up on push error reply", async () => {
      const agent = createAgent();
      agent.run(defaultInput).subscribe({ next: () => {}, error: () => {} });
      await flushAsyncWork();

      const channel = getChannel(agent)!;
      channel.triggerJoin("ok");
      agent.abortRun();

      const stopEntry = channel.pushLog.find((c) => c.event === "stop_run")!;
      stopEntry.push.trigger("error");

      expect(channel.left).toBe(true);
    });

    it("cleans up on push timeout reply", async () => {
      const agent = createAgent();
      agent.run(defaultInput).subscribe({ next: () => {}, error: () => {} });
      await flushAsyncWork();

      const channel = getChannel(agent)!;
      channel.triggerJoin("ok");
      agent.abortRun();

      const stopEntry = channel.pushLog.find((c) => c.event === "stop_run")!;
      stopEntry.push.trigger("timeout");

      expect(channel.left).toBe(true);
    });

    it("cleans up immediately via fallback timer when socket is down", async () => {
      vi.useFakeTimers();

      try {
        const agent = createAgent();
        agent.run(defaultInput).subscribe({ next: () => {}, error: () => {} });
        await waitForConnection(agent);

        const channel = getChannel(agent)!;
        channel.triggerJoin("ok");
        agent.abortRun();

        expect(channel.left).toBe(false);

        vi.advanceTimersByTime(5_000);
        expect(channel.left).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it("cleans up immediately when no run is active", () => {
      const agent = createAgent();
      expect(() => agent.abortRun()).not.toThrow();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("keeps the provided run id when replayed baseline events carry a different backend run id", async () => {
      mockFetch.mockResolvedValueOnce(
        await jsonResponse({
          mode: "live",
          joinToken: "jt-123",
          joinFromEventId: "event-2",
          events: [
            {
              type: EventType.RUN_STARTED,
              threadId: "thread-1",
              run_id: "backend-run-1",
              input: {
                messages: [
                  {
                    id: "msg-1",
                    role: "user",
                    content: "hello",
                  },
                ],
              },
            },
          ],
        }),
      );

      const agent = createAgent();
      setThreadIdForTest(agent, "thread-1");

      const reconnectPromise = agent.connectAgent({ runId: "run-1" });
      await waitForConnection(agent);

      const channel = getChannel(agent)!;
      channel.triggerJoin("ok");
      await flushAsyncWork();

      agent.abortRun();

      const stopEntry = channel.pushLog.find((c) => c.event === "stop_run");
      expect(stopEntry).toBeDefined();
      expect(stopEntry!.payload).toEqual({ run_id: "run-1" });

      stopEntry!.push.trigger("ok");

      const result = await reconnectPromise;
      expect(result.newMessages).toEqual([
        {
          id: "msg-1",
          role: "user",
          content: "hello",
        },
      ]);
    });
  });

  describe("unsubscribe cleanup", () => {
    it("leaves the channel and disconnects the socket on unsubscribe", async () => {
      const agent = createAgent();
      const subscription = agent
        .run(defaultInput)
        .subscribe({ next: () => {}, error: () => {} });
      await flushAsyncWork();

      const socket = getSocket(agent)!;
      const channel = getChannel(agent)!;
      channel.triggerJoin("ok");

      subscription.unsubscribe();

      expect(channel.left).toBe(true);
      expect(socket.disconnected).toBe(true);
    });
  });

  describe("credentials forwarding", () => {
    it("forwards credentials on run fetch when configured", async () => {
      const agent = new IntelligenceAgent({
        url: "ws://localhost:4000/client",
        runtimeUrl: "http://localhost:4000",
        agentId: "my-agent",
        credentials: "include",
      });
      agent.run(defaultInput).subscribe({ next: () => {}, error: () => {} });
      await flushAsyncWork();

      const [, options] = mockFetch.mock.calls[0];
      expect(options.credentials).toBe("include");
    });

    it("omits credentials when not configured", async () => {
      const agent = createAgent();
      agent.run(defaultInput).subscribe({ next: () => {}, error: () => {} });
      await flushAsyncWork();

      const [, options] = mockFetch.mock.calls[0];
      expect(options.credentials).toBeUndefined();
    });
  });

  describe("connect", () => {
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
        channel: MockChannel | null;
        socket: MockSocket | null;
      }>((resolve) => {
        connectWithTestAccess(agent, input).subscribe({
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

    it("fetches a live connect plan and joins the thread topic without pushing connect", async () => {
      mockFetch.mockResolvedValueOnce(
        await jsonResponse({
          mode: "live",
          joinToken: "jt-123",
          joinFromEventId: null,
          events: [],
        }),
      );

      const agent = createAgent();
      connectWithTestAccess(agent, defaultInput).subscribe({
        next: () => {},
        error: () => {},
      });
      await waitForConnection(agent);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain("/agent/my-agent/connect");

      const socket = getSocket(agent)!;
      expect(socket.opts.params).toEqual({
        token: "test-token",
        join_token: "jt-123",
      });

      const channel = getChannel(agent)!;
      expect(channel.topic).toBe("thread:thread-1");
      expect(channel.params).toEqual({
        stream_mode: "connect",
        last_seen_event_id: null,
      });

      channel.triggerJoin("ok");
      expect(channel.pushLog).toHaveLength(0);
    });

    it("reuses the latest cpki_event_id value as the replay cursor", async () => {
      const agent = createAgent();
      agent.run(defaultInput).subscribe({ next: () => {}, error: () => {} });
      await waitForConnection(agent);

      const runChannel = getChannel(agent)!;
      runChannel.triggerJoin("ok");
      runChannel.serverPush("ag_ui_event", {
        type: EventType.TEXT_MESSAGE_CONTENT,
        metadata: {
          cpki_event_id: "event-1",
          cpki_event_seq: 1,
        },
      } as BaseEvent);

      mockFetch.mockResolvedValueOnce(
        await jsonResponse({
          mode: "live",
          joinToken: "jt-123",
          joinFromEventId: "event-1",
          events: [],
        }),
      );

      connectWithTestAccess(agent, defaultInput).subscribe({
        next: () => {},
        error: () => {},
      });
      await waitForConnection(agent);

      const connectChannel = getChannel(agent)!;
      expect(connectChannel.params).toEqual({
        stream_mode: "connect",
        last_seen_event_id: "event-1",
      });
    });

    it("completes on RUN_FINISHED from server", async () => {
      mockFetch.mockResolvedValueOnce(
        await jsonResponse({
          mode: "live",
          joinToken: "jt-123",
          joinFromEventId: null,
          events: [],
        }),
      );

      const agent = createAgent();
      const promise = connectAgent(agent);
      await waitForConnection(agent);

      const channel = getChannel(agent)!;
      channel.triggerJoin("ok");
      await flushAsyncWork();

      channel.serverPush("ag_ui_event", {
        type: EventType.RUN_FINISHED,
        threadId: "thread-1",
        runId: "run-1",
      } as BaseEvent);
      await flushAsyncWork();

      const result = await promise;
      expect(result.completed).toBe(true);
      expect(result.error).toBeNull();
    });

    it("completes immediately without creating a socket on 204 connect", async () => {
      mockFetch.mockResolvedValueOnce(await emptyResponse());

      const agent = createAgent();
      const result = await connectAgent(agent);

      expect(result.completed).toBe(true);
      expect(result.error).toBeNull();
      expect(result.events).toHaveLength(0);
      expect(result.socket).toBeNull();
      expect(result.channel).toBeNull();
    });

    it("completes on RUN_ERROR from server", async () => {
      mockFetch.mockResolvedValueOnce(
        await jsonResponse({
          mode: "live",
          joinToken: "jt-123",
          joinFromEventId: null,
          events: [],
        }),
      );

      const agent = createAgent();
      const promise = connectAgent(agent);
      await waitForConnection(agent);

      const channel = getChannel(agent)!;
      channel.triggerJoin("ok");
      await flushAsyncWork();

      channel.serverPush("ag_ui_event", {
        type: EventType.RUN_ERROR,
        message: "something went wrong",
      } as BaseEvent);
      await flushAsyncWork();

      const result = await promise;
      expect(result.completed).toBe(true);
      expect(result.error).toBeNull();
      expect(result.events).toEqual([
        {
          type: EventType.RUN_ERROR,
          message: "something went wrong",
        },
      ]);
    });

    it("applies event-native bootstrap events and completes without creating a socket", async () => {
      mockFetch.mockResolvedValueOnce(
        await jsonResponse({
          mode: "bootstrap",
          latestEventId: "event-2",
          events: [
            {
              type: EventType.RUN_STARTED,
              threadId: "thread-1",
              run_id: "backend-run-1",
              input: {
                messages: [
                  {
                    id: "msg-1",
                    role: "user",
                    content: "hello",
                  },
                ],
              },
            },
            {
              type: EventType.RUN_FINISHED,
            },
          ],
        }),
      );

      const agent = createAgent();
      const promise = connectAgent(agent);
      await waitForConnection(agent);

      const result = await promise;
      expect(result.completed).toBe(true);
      expect(result.error).toBeNull();
      expect(result.socket).toBeNull();
      expect(result.channel).toBeNull();
      expect(result.events).toEqual([
        {
          type: EventType.RUN_STARTED,
          threadId: "thread-1",
          run_id: "backend-run-1",
          input: {
            messages: [
              {
                id: "msg-1",
                role: "user",
                content: "hello",
              },
            ],
          },
        },
        {
          type: EventType.RUN_FINISHED,
        },
      ]);
    });

    it("applies bootstrap RUN_STARTED baseline events without creating a socket", async () => {
      mockFetch.mockResolvedValueOnce(
        await jsonResponse({
          mode: "bootstrap",
          latestEventId: "event-2",
          events: [
            {
              type: EventType.RUN_STARTED,
              threadId: "thread-1",
              run_id: "backend-run-1",
              input: {
                messages: [
                  {
                    id: "msg-1",
                    role: "user",
                    content: "hello",
                  },
                ],
              },
            },
          ],
        }),
      );

      const agent = createAgent();
      const promise = connectAgent(agent);
      await waitForConnection(agent);

      const result = await promise;
      expect(result.completed).toBe(true);
      expect(result.error).toBeNull();
      expect(result.socket).toBeNull();
      expect(result.channel).toBeNull();
      expect(result.events).toEqual([
        {
          type: EventType.RUN_STARTED,
          threadId: "thread-1",
          run_id: "backend-run-1",
          input: {
            messages: [
              {
                id: "msg-1",
                role: "user",
                content: "hello",
              },
            ],
          },
        },
      ]);
      expect(getCanonicalRunIdForTest(agent)).toBe("run-1");
    });

    it("applies event-native finished-thread bootstrap baselines with restored activity state", async () => {
      const restoredActivity = {
        a2ui_operations: [
          {
            version: "v0.9",
            createSurface: {
              surfaceId: "surface-1",
              catalogId:
                "https://a2ui.org/specification/v0_9/basic_catalog.json",
            },
          },
          {
            version: "v0.9",
            updateComponents: {
              surfaceId: "surface-1",
              components: [
                {
                  id: "root",
                  component: "Text",
                  text: "Restored dashboard",
                  variant: "body",
                },
              ],
            },
          },
        ],
      };

      mockFetch.mockResolvedValueOnce(
        await jsonResponse({
          mode: "bootstrap",
          latestEventId: "event-3",
          events: [
            {
              type: EventType.RUN_STARTED,
              threadId: "thread-1",
              run_id: "backend-run-1",
              input: {
                messages: [
                  {
                    id: "msg-1",
                    role: "user",
                    content: "show me the restored ui",
                  },
                ],
              },
            },
            {
              type: EventType.ACTIVITY_SNAPSHOT,
              messageId: "activity-1",
              activityType: "a2ui-surface",
              content: restoredActivity,
            },
            {
              type: EventType.RUN_FINISHED,
            },
          ],
        }),
      );

      const agent = createAgent();
      const promise = connectAgent(agent);
      await waitForConnection(agent);

      const result = await promise;
      expect(result.completed).toBe(true);
      expect(result.error).toBeNull();
      expect(result.socket).toBeNull();
      expect(result.channel).toBeNull();
      expect(result.events).toEqual([
        {
          type: EventType.RUN_STARTED,
          threadId: "thread-1",
          run_id: "backend-run-1",
          input: {
            messages: [
              {
                id: "msg-1",
                role: "user",
                content: "show me the restored ui",
              },
            ],
          },
        },
        {
          type: EventType.ACTIVITY_SNAPSHOT,
          messageId: "activity-1",
          activityType: "a2ui-surface",
          content: restoredActivity,
        },
        {
          type: EventType.RUN_FINISHED,
        },
      ]);
    });

    it("applies event-native finished-thread bootstrap baselines with restored open generative ui activity state", async () => {
      const restoredActivity = {
        initialHeight: 180,
        generating: false,
        html: [
          "<head></head><body><div>Restored open generative UI</div></body>",
        ],
        htmlComplete: true,
      };

      mockFetch.mockResolvedValueOnce(
        await jsonResponse({
          mode: "bootstrap",
          latestEventId: "event-3",
          events: [
            {
              type: EventType.RUN_STARTED,
              threadId: "thread-1",
              run_id: "backend-run-1",
              input: {
                messages: [
                  {
                    id: "msg-1",
                    role: "user",
                    content: "show me the restored app",
                  },
                ],
              },
            },
            {
              type: EventType.ACTIVITY_SNAPSHOT,
              messageId: "activity-1",
              activityType: "open-generative-ui",
              content: restoredActivity,
            },
            {
              type: EventType.RUN_FINISHED,
            },
          ],
        }),
      );

      const agent = createAgent();
      const promise = connectAgent(agent);
      await waitForConnection(agent);

      const result = await promise;
      expect(result.completed).toBe(true);
      expect(result.error).toBeNull();
      expect(result.socket).toBeNull();
      expect(result.channel).toBeNull();
      expect(result.events).toEqual([
        {
          type: EventType.RUN_STARTED,
          threadId: "thread-1",
          run_id: "backend-run-1",
          input: {
            messages: [
              {
                id: "msg-1",
                role: "user",
                content: "show me the restored app",
              },
            ],
          },
        },
        {
          type: EventType.ACTIVITY_SNAPSHOT,
          messageId: "activity-1",
          activityType: "open-generative-ui",
          content: restoredActivity,
        },
        {
          type: EventType.RUN_FINISHED,
        },
      ]);
    });

    it("hydrates messages from bootstrap RUN_STARTED baseline events through connectAgent", async () => {
      mockFetch.mockResolvedValueOnce(
        await jsonResponse({
          mode: "bootstrap",
          latestEventId: "event-2",
          events: [
            {
              type: EventType.RUN_STARTED,
              threadId: "thread-1",
              run_id: "backend-run-1",
              input: {
                messages: [
                  {
                    id: "msg-1",
                    role: "user",
                    content: "hello",
                  },
                ],
              },
            },
          ],
        }),
      );

      const agent = createAgent();
      setThreadIdForTest(agent, "thread-1");

      const result = await agent.connectAgent({ runId: "run-1" });

      expect(result.newMessages).toEqual([
        {
          id: "msg-1",
          role: "user",
          content: "hello",
        },
      ]);
      expect(agent.messages).toEqual([
        {
          id: "msg-1",
          role: "user",
          content: "hello",
        },
      ]);
      expect(getCanonicalRunIdForTest(agent)).toBe("run-1");
      expect(getSocket(agent)).toBeNull();
      expect(getChannel(agent)).toBeNull();
    });

    it("hydrates agent state from bootstrap STATE_SNAPSHOT events through connectAgent", async () => {
      // Reproduces the shared-state thread-resume case:
      // on resume, the /connect bootstrap plan replays STATE_SNAPSHOT events
      // captured during the original run. After connectAgent resolves,
      // agent.state must reflect the final snapshot — otherwise UI that reads
      // from agent.state (e.g. todo list) shows empty on resume.
      const finalSnapshot = {
        todos: [
          { id: "1", title: "Read CopilotKit docs", status: "pending" },
          { id: "2", title: "Build a CopilotKit prototype", status: "pending" },
          { id: "3", title: "Explore agent state", status: "pending" },
        ],
      };

      mockFetch.mockResolvedValueOnce(
        await jsonResponse({
          mode: "bootstrap",
          latestEventId: "event-4",
          events: [
            {
              type: EventType.RUN_STARTED,
              threadId: "thread-1",
              run_id: "backend-run-1",
              input: { messages: [] },
            },
            // Earlier intermediate snapshot — agent.state must not be stuck here.
            {
              type: EventType.STATE_SNAPSHOT,
              snapshot: {
                todos: [
                  { id: "1", title: "Read CopilotKit docs", status: "pending" },
                ],
              },
            },
            // Final snapshot captured before RUN_FINISHED.
            {
              type: EventType.STATE_SNAPSHOT,
              snapshot: finalSnapshot,
            },
            { type: EventType.RUN_FINISHED },
          ],
        }),
      );

      const agent = createAgent();
      setThreadIdForTest(agent, "thread-1");

      await agent.connectAgent({ runId: "run-1" });

      expect(agent.state).toEqual(finalSnapshot);
    });

    it("does not create a socket for bootstrap-only connect plans", async () => {
      mockFetch.mockResolvedValueOnce(
        await jsonResponse({
          mode: "bootstrap",
          latestEventId: "event-2",
          events: [
            {
              type: EventType.RUN_STARTED,
              threadId: "thread-1",
              run_id: "backend-run-1",
              input: {
                messages: [],
              },
            },
            {
              type: EventType.RUN_FINISHED,
            },
          ],
        }),
      );

      const agent = createAgent();
      const promise = connectAgent(agent);
      await waitForConnection(agent);

      const result = await promise;
      expect(result.completed).toBe(true);
      expect(result.error).toBeNull();
      expect(result.socket).toBeNull();
      expect(result.channel).toBeNull();
      expect(result.events).toEqual([
        {
          type: EventType.RUN_STARTED,
          threadId: "thread-1",
          run_id: "backend-run-1",
          input: {
            messages: [],
          },
        },
        {
          type: EventType.RUN_FINISHED,
        },
      ]);
    });

    it("emits RUN_STARTED baseline events before opening a live socket", async () => {
      mockFetch.mockResolvedValueOnce(
        await jsonResponse({
          mode: "live",
          joinToken: "jt-123",
          joinFromEventId: "event-2",
          events: [
            {
              type: EventType.RUN_STARTED,
              threadId: "thread-1",
              run_id: "backend-run-1",
              input: {
                messages: [
                  {
                    id: "msg-1",
                    role: "user",
                    content: "hello",
                  },
                ],
              },
            },
          ],
        }),
      );

      const agent = createAgent();
      const events: BaseEvent[] = [];

      connectWithTestAccess(agent, defaultInput).subscribe({
        next: (event: BaseEvent) => events.push(event),
        error: () => {},
      });
      await waitForConnection(agent);

      const channel = getChannel(agent)!;
      channel.triggerJoin("ok");

      await flushAsyncWork();

      expect(events[0]).toEqual({
        type: EventType.RUN_STARTED,
        threadId: "thread-1",
        run_id: "backend-run-1",
        input: {
          messages: [
            {
              id: "msg-1",
              role: "user",
              content: "hello",
            },
          ],
        },
      });
      expect(getCanonicalRunIdForTest(agent)).toBe("run-1");
    });

    it("errors the observable on connect fetch failure", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const agent = createAgent();
      const result = await new Promise<{
        error: Error | null;
      }>((resolve) => {
        connectWithTestAccess(agent, defaultInput).subscribe({
          next: () => {},
          error: (error: Error) => resolve({ error }),
        });
      });

      expect(result.error).toBeInstanceOf(Error);
      expect(result.error!.message).toContain("REST connect request failed");
      expect(getSocket(agent)).toBeNull();
    });

    it("errors the observable on join error", async () => {
      mockFetch.mockResolvedValueOnce(
        await jsonResponse({
          mode: "live",
          joinToken: "jt-123",
          joinFromEventId: null,
          events: [],
        }),
      );

      const agent = createAgent();
      const promise = connectAgent(agent);
      await waitForConnection(agent);

      getChannel(agent)!.triggerJoin("error", { reason: "unauthorized" });

      const result = await promise;
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error!.message).toContain("Failed to join channel");
    });

    it("does not error the observable on a single channel crash (Phoenix retries)", async () => {
      mockFetch.mockResolvedValueOnce(
        await jsonResponse({
          mode: "live",
          joinToken: "jt-123",
          joinFromEventId: null,
          events: [],
        }),
      );

      const agent = createAgent();
      let error: Error | null = null;
      connectWithTestAccess(agent, defaultInput).subscribe({
        next: () => {},
        error: (err: Error) => {
          error = err;
        },
      });
      await waitForConnection(agent);

      const channel = getChannel(agent)!;
      channel.triggerJoin("ok");
      channel.triggerError("server crash");

      expect(error).toBeNull();
    });

    it("errors the observable after MAX_CONSECUTIVE_ERRORS socket errors", async () => {
      mockFetch.mockResolvedValueOnce(
        await jsonResponse({
          mode: "live",
          joinToken: "jt-123",
          joinFromEventId: null,
          events: [],
        }),
      );

      const agent = createAgent();
      const promise = connectAgent(agent);
      await waitForConnection(agent);

      getChannel(agent)!.triggerJoin("ok");

      for (let i = 0; i < 5; i++) {
        getSocket(agent)!.triggerError(new Error("network failure"));
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
      expect(getConfigForTest(cloned)).toEqual(getConfigForTest(agent));
    });

    it("shares replay cursor state across clones when reconnecting with local messages", async () => {
      const agent = createAgent();
      agent.run(defaultInput).subscribe({ next: () => {}, error: () => {} });
      await waitForConnection(agent);

      const runChannel = getChannel(agent)!;
      runChannel.triggerJoin("ok");
      runChannel.serverPush("ag_ui_event", {
        type: EventType.TEXT_MESSAGE_CONTENT,
        metadata: {
          cpki_event_id: "event-2",
          cpki_event_seq: 2,
        },
      } as BaseEvent);

      const cloned = agent.clone();
      const reconnectInput = {
        ...defaultInput,
        messages: [
          {
            id: "msg-1",
            role: "user",
            content: "hello",
          },
        ],
      };
      mockFetch.mockResolvedValueOnce(
        await jsonResponse({
          mode: "live",
          joinToken: "jt-123",
          joinFromEventId: "event-2",
          events: [],
        }),
      );
      connectWithTestAccess(cloned, reconnectInput).subscribe({
        next: () => {},
        error: () => {},
      });
      await waitForConnection(cloned);

      const connectChannel = getChannel(cloned)!;
      expect(connectChannel.params).toEqual({
        stream_mode: "connect",
        last_seen_event_id: "event-2",
      });
    });

    it("does not reuse a cached replay cursor when reconnecting with no local messages", async () => {
      const agent = createAgent();
      agent.run(defaultInput).subscribe({ next: () => {}, error: () => {} });
      await waitForConnection(agent);

      const runChannel = getChannel(agent)!;
      runChannel.triggerJoin("ok");
      runChannel.serverPush("ag_ui_event", {
        type: EventType.TEXT_MESSAGE_CONTENT,
        metadata: {
          cpki_event_id: "event-2",
          cpki_event_seq: 2,
        },
      } as BaseEvent);

      const cloned = agent.clone();
      mockFetch.mockResolvedValueOnce(
        await jsonResponse({
          mode: "live",
          joinToken: "jt-123",
          joinFromEventId: null,
          events: [],
        }),
      );
      connectWithTestAccess(cloned, defaultInput).subscribe({
        next: () => {},
        error: () => {},
      });
      await waitForConnection(cloned);

      expect(JSON.parse(mockFetch.mock.calls[1][1].body)).toMatchObject({
        lastSeenEventId: null,
      });

      const connectChannel = getChannel(cloned)!;
      expect(connectChannel.params).toEqual({
        stream_mode: "connect",
        last_seen_event_id: null,
      });
    });
  });
});

describe("ProxiedCopilotRuntimeAgent (intelligence mode)", () => {
  // Mirrors the real demo wiring: Vite app → BFF runtime that exposes a
  // ProxiedCopilotRuntimeAgent in intelligence mode → IntelligenceAgent delegate
  // talking to the realtime gateway. On thread resume, the delegate's /connect
  // bootstrap plan replays STATE_SNAPSHOT events captured during the original run;
  // the proxy bridges delegate.state → proxy.state so useAgent re-renders.
  it("hydrates proxy state from bootstrap STATE_SNAPSHOT events via the intelligence delegate", async () => {
    const finalSnapshot = {
      todos: [
        { id: "1", title: "Read CopilotKit docs", status: "pending" },
        { id: "2", title: "Build a CopilotKit prototype", status: "pending" },
        { id: "3", title: "Explore agent state", status: "pending" },
      ],
    };

    mockFetch.mockResolvedValueOnce(
      await jsonResponse({
        mode: "bootstrap",
        latestEventId: "event-4",
        events: [
          {
            type: EventType.RUN_STARTED,
            threadId: "thread-1",
            run_id: "backend-run-1",
            input: { messages: [] },
          },
          {
            type: EventType.STATE_SNAPSHOT,
            snapshot: {
              todos: [
                { id: "1", title: "Read CopilotKit docs", status: "pending" },
              ],
            },
          },
          { type: EventType.STATE_SNAPSHOT, snapshot: finalSnapshot },
          { type: EventType.RUN_FINISHED },
        ],
      }),
    );

    const agent = new ProxiedCopilotRuntimeAgent({
      runtimeUrl: "http://localhost:4000/api/copilotkit",
      agentId: "default",
      runtimeMode: RUNTIME_MODE_INTELLIGENCE,
      intelligence: { wsUrl: "ws://localhost:4401/client" },
    });
    agent.threadId = "thread-1";

    await agent.connectAgent({ runId: "run-1" });

    expect(agent.state).toEqual(finalSnapshot);
  });
});
