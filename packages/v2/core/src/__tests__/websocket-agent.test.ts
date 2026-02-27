import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventType, RunAgentInput } from "@ag-ui/client";
import { firstValueFrom, toArray } from "rxjs";
import { WebSocketAgent } from "../agent";

const INPUT: RunAgentInput = {
  threadId: "thread-1",
  runId: "run-1",
  messages: [],
  state: {},
  tools: [],
  context: [],
  forwardedProps: {},
};

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly url: string;
  readyState = MockWebSocket.CONNECTING;
  sentMessages: string[] = [];
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  open() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.(new Event("open"));
  }

  send(data: string) {
    this.sentMessages.push(data);
  }

  emit(message: unknown) {
    this.onmessage?.(
      {
        data: JSON.stringify(message),
      } as MessageEvent,
    );
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({} as CloseEvent);
  }
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function assertJoinedToken(
  sentMessages: string[],
  token: string,
  topic = `thread:${token}`,
) {
  const joins = sentMessages
    .map((message) => JSON.parse(message) as unknown[])
    .filter((message) => Array.isArray(message) && message[3] === "phx_join");

  const found = joins.some(
    (join) =>
      join[2] === topic &&
      typeof join[4] === "object" &&
      join[4] !== null &&
      "token" in (join[4] as Record<string, unknown>) &&
      (join[4] as Record<string, unknown>).token === token,
  );
  expect(found).toBe(true);
}

describe("WebSocketAgent", () => {
  const originalFetch = global.fetch;
  const originalWebSocket = global.WebSocket;

  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.restoreAllMocks();
    vi.spyOn(global, "fetch");
    // @ts-expect-error test override
    global.WebSocket = MockWebSocket;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    global.fetch = originalFetch;
    global.WebSocket = originalWebSocket;
  });

  it("uses run-ws token flow and streams parsed events", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          token: "tok-run",
          expiresInSeconds: 30,
          threadId: "thread-9",
          wsUrl: "wss://gateway.example/ws",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    global.fetch = fetchMock as typeof fetch;

    const agent = new WebSocketAgent({
      restUrl: "https://bff.example/api",
      wsUrl: "wss://gateway.example/ws",
      agentId: "default",
    });

    const runPromise = firstValueFrom(agent.run(INPUT).pipe(toArray()));

    await flushMicrotasks();

    expect(fetchMock).toHaveBeenCalledWith(
      "https://bff.example/api/agent/default/run-ws",
      expect.objectContaining({ method: "POST" }),
    );

    expect(MockWebSocket.instances).toHaveLength(1);
    const ws = MockWebSocket.instances[0];
    ws.open();

    assertJoinedToken(ws.sentMessages, "tok-run");
    ws.emit([
      "1",
      "1",
      "thread:tok-run",
      "phx_reply",
      { status: "ok", response: {} },
    ]);
    ws.emit([
      "1",
      "2",
      "thread:tok-run",
      "agui_event",
      { type: EventType.RUN_ERROR, message: "finished" },
    ]);

    const events = await runPromise;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: EventType.RUN_ERROR,
      message: "finished",
    });
    expect(agent.threadId).toBe("thread-9");
  });

  it("uses connect-ws token flow for connectAgent", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            token: "tok-connect",
            expiresInSeconds: 30,
            threadId: "thread-connect",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    global.fetch = fetchMock as typeof fetch;

    const agent = new WebSocketAgent({
      restUrl: "https://bff.example",
      wsUrl: "wss://gateway.example/ws",
      agentId: "agent-a",
    });

    const connectPromise = agent.connectAgent({});
    await flushMicrotasks();

    const ws = MockWebSocket.instances[0];
    ws.open();
    assertJoinedToken(ws.sentMessages, "tok-connect");
    ws.emit([
      "1",
      "1",
      "thread:tok-connect",
      "phx_reply",
      { status: "ok", response: {} },
    ]);
    ws.emit([
      "1",
      "2",
      "thread:tok-connect",
      "agui_event",
      { type: EventType.RUN_ERROR, message: "connect-complete" },
    ]);

    await connectPromise;
    expect(fetchMock).toHaveBeenCalledWith(
      "https://bff.example/agent/agent-a/connect-ws",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("multiplexes multiple tokens over one shared socket per wsUrl", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            token: "tok-1",
            expiresInSeconds: 30,
            threadId: "thread-1",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            token: "tok-2",
            expiresInSeconds: 30,
            threadId: "thread-2",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    global.fetch = fetchMock as typeof fetch;

    const agentA = new WebSocketAgent({
      restUrl: "https://bff.example",
      wsUrl: "wss://gateway.example/ws",
      agentId: "agent-a",
    });
    const agentB = new WebSocketAgent({
      restUrl: "https://bff.example",
      wsUrl: "wss://gateway.example/ws",
      agentId: "agent-b",
    });

    const aPromise = firstValueFrom(agentA.run(INPUT).pipe(toArray()));
    const bPromise = firstValueFrom(agentB.run(INPUT).pipe(toArray()));

    await flushMicrotasks();

    expect(MockWebSocket.instances).toHaveLength(1);
    const ws = MockWebSocket.instances[0];
    ws.open();

    assertJoinedToken(ws.sentMessages, "tok-1");
    assertJoinedToken(ws.sentMessages, "tok-2");
    ws.emit(["1", "1", "thread:tok-1", "phx_reply", { status: "ok" }]);
    ws.emit(["2", "2", "thread:tok-2", "phx_reply", { status: "ok" }]);
    ws.emit([
      "1",
      "3",
      "thread:tok-1",
      "agui_event",
      { type: EventType.RUN_ERROR, message: "done-1" },
    ]);
    ws.emit([
      "2",
      "4",
      "thread:tok-2",
      "agui_event",
      { type: EventType.RUN_ERROR, message: "done-2" },
    ]);

    const [eventsA, eventsB] = await Promise.all([aPromise, bPromise]);
    expect(eventsA[0]).toMatchObject({ message: "done-1" });
    expect(eventsB[0]).toMatchObject({ message: "done-2" });
  });

  it("preserves config in clone and sends stop on abortRun", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    global.fetch = fetchMock as typeof fetch;

    const agent = new WebSocketAgent({
      restUrl: "https://bff.example/",
      wsUrl: "wss://gateway.example/ws",
      agentId: "agent-clone",
      headers: { Authorization: "Bearer x" },
      credentials: "include",
      threadId: "thread-77",
    });

    const clone = agent.clone();
    expect(clone.restUrl).toBe("https://bff.example");
    expect(clone.wsUrl).toBe("wss://gateway.example/ws");
    expect(clone.agentId).toBe("agent-clone");
    expect(clone.threadId).toBe("thread-77");

    agent.abortRun();

    expect(fetchMock).toHaveBeenCalledWith(
      "https://bff.example/agent/agent-clone/stop/thread-77",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
      }),
    );
  });
});
