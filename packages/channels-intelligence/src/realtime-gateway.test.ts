import { describe, expect, it } from "vitest";
import { connectRealtimeGateway } from "./realtime-gateway.js";

type JoinMode = "ok" | "error" | "never" | "error-undefined-reason";

function makeFakeWebSocket(mode: JoinMode) {
  const instances: FakeWebSocket[] = [];
  class FakeWebSocket {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;
    readyState = 0;
    onopen: ((ev?: unknown) => void) | null = null;
    onmessage: ((ev: { data: string }) => void) | null = null;
    onerror: ((ev?: unknown) => void) | null = null;
    onclose: ((ev?: unknown) => void) | null = null;
    closed = false;
    readonly frames: unknown[] = [];

    constructor(public readonly url: string) {
      instances.push(this);
      queueMicrotask(() => {
        this.readyState = 1;
        this.onopen?.();
      });
    }

    send(data: string): void {
      if (mode === "never") return;
      let frame: unknown;
      try {
        frame = JSON.parse(data);
      } catch {
        return;
      }
      this.frames.push(frame);
      if (!Array.isArray(frame)) return;
      const [joinRef, ref, topic, event] = frame as [
        string,
        string,
        string,
        string,
      ];
      if (event !== "phx_join") return;
      const status = mode === "ok" ? "ok" : "error";
      // `error-undefined-reason` omits the `response` key entirely (rather
      // than sending an object) so it round-trips through JSON as a genuinely
      // absent value — exercising `safeReason(undefined)`.
      const reply =
        mode === "error-undefined-reason"
          ? { status }
          : {
              status,
              response: mode === "ok" ? {} : { reason: "unauthorized" },
            };
      queueMicrotask(() =>
        this.onmessage?.({
          data: JSON.stringify([joinRef, ref, topic, "phx_reply", reply]),
        }),
      );
    }

    close(): void {
      this.closed = true;
      this.readyState = 3;
      this.onclose?.();
    }
  }
  return { FakeWebSocket, instances };
}

describe("connectRealtimeGateway", () => {
  it("rejects a non-positive project id before constructing a WebSocket", async () => {
    let socketConstructed = false;
    class NeverWebSocket {
      constructor() {
        socketConstructed = true;
      }
    }

    await expect(
      connectRealtimeGateway({
        wsUrl: "wss://gateway.example/socket",
        apiKey: "cpk-test",
        projectId: 0,
        join: {
          runtimeInstanceId: "rti_1",
          declaredChannels: [],
          observedAt: "2026-07-10T00:00:00.000Z",
        },
        webSocket: NeverWebSocket,
      }),
    ).rejects.toThrow(/projectId must be a positive integer/i);
    expect(socketConstructed).toBe(false);
  });

  it("joins the channel topic with declared channels and disconnects the gateway session", async () => {
    const { FakeWebSocket, instances } = makeFakeWebSocket("ok");
    const join = {
      runtimeInstanceId: "rti_1",
      declaredChannels: [{ channelName: "opentag", adapter: "slack" }],
      observedAt: "2026-07-10T00:00:00.000Z",
    };

    const session = await connectRealtimeGateway({
      wsUrl: "wss://gateway.example/socket",
      apiKey: "cpk-test",
      projectId: 7,
      join,
      webSocket: FakeWebSocket,
    });

    expect(instances).toHaveLength(1);
    const joinFrame = instances[0]!.frames.find(
      (frame) => Array.isArray(frame) && frame[3] === "phx_join",
    ) as [string, string, string, string, unknown];
    expect(joinFrame[2]).toBe("channels:project:7");
    expect(joinFrame[4]).toEqual(join);

    session.disconnect();
    expect(instances[0]!.closed).toBe(true);
  });
});

describe("connectRealtimeGateway — onClose drop notification (OSS-473)", () => {
  it("fires a registered onClose callback exactly once when the socket drops unexpectedly", async () => {
    const { FakeWebSocket, instances } = makeFakeWebSocket("ok");
    const session = await connectRealtimeGateway({
      wsUrl: "wss://gateway.example/socket",
      apiKey: "cpk-test",
      projectId: 7,
      join: {
        runtimeInstanceId: "rti_1",
        declaredChannels: [{ channelName: "opentag", adapter: "slack" }],
        observedAt: "2026-07-10T00:00:00.000Z",
      },
      webSocket: FakeWebSocket,
    });

    let calls = 0;
    session.onClose(() => {
      calls += 1;
    });

    // Simulate an unexpected transport drop (not our own disconnect()) — this
    // fires Phoenix's socket `onClose` AND (via triggerChanError) the
    // channel's `onError` for the very same event.
    instances[0]!.onclose?.();

    expect(calls).toBe(1);
  });

  it("fires onClose again for a second drop after the socket reopens", async () => {
    const { FakeWebSocket, instances } = makeFakeWebSocket("ok");
    const session = await connectRealtimeGateway({
      wsUrl: "wss://gateway.example/socket",
      apiKey: "cpk-test",
      projectId: 7,
      join: {
        runtimeInstanceId: "rti_1",
        declaredChannels: [{ channelName: "opentag", adapter: "slack" }],
        observedAt: "2026-07-10T00:00:00.000Z",
      },
      webSocket: FakeWebSocket,
    });

    let calls = 0;
    session.onClose(() => {
      calls += 1;
    });

    // First drop episode: all four Phoenix hooks fire for the same event,
    // but the callback still only runs once.
    instances[0]!.onclose?.();
    instances[0]!.onerror?.();
    expect(calls).toBe(1);

    // Phoenix's `Socket` auto-reconnects an unclean close: it tears down the
    // dropped transport and opens a fresh one (see `reconnectTimer` in
    // `socket.js`). Wait for that real reconnect to construct the next fake
    // WebSocket, whose constructor fires `onopen` after a microtask — the
    // real seam that drives `socket.onOpen` and resets the dedupe latch.
    const deadline = Date.now() + 2000;
    while (instances.length < 2 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(instances).toHaveLength(2);
    // Let the new instance's queued `onopen` microtask run.
    await new Promise((resolve) => setTimeout(resolve, 0));

    // A second, distinct drop episode after reconnect must notify again —
    // the docstring promises "exactly once per drop", not once ever.
    instances[1]!.onclose?.();
    expect(calls).toBe(2);
  });

  it("does not fire onClose when the drop is our own disconnect()", async () => {
    const { FakeWebSocket, instances } = makeFakeWebSocket("ok");
    const session = await connectRealtimeGateway({
      wsUrl: "wss://gateway.example/socket",
      apiKey: "cpk-test",
      projectId: 7,
      join: {
        runtimeInstanceId: "rti_1",
        declaredChannels: [{ channelName: "opentag", adapter: "slack" }],
        observedAt: "2026-07-10T00:00:00.000Z",
      },
      webSocket: FakeWebSocket,
    });

    let calls = 0;
    session.onClose(() => {
      calls += 1;
    });

    session.disconnect();

    expect(instances[0]!.closed).toBe(true);
    expect(calls).toBe(0);
  });

  it("still fires later onClose callbacks when an earlier one throws", async () => {
    const { FakeWebSocket, instances } = makeFakeWebSocket("ok");
    const session = await connectRealtimeGateway({
      wsUrl: "wss://gateway.example/socket",
      apiKey: "cpk-test",
      projectId: 7,
      join: {
        runtimeInstanceId: "rti_1",
        declaredChannels: [{ channelName: "opentag", adapter: "slack" }],
        observedAt: "2026-07-10T00:00:00.000Z",
      },
      webSocket: FakeWebSocket,
    });

    let secondCalls = 0;
    session.onClose(() => {
      throw new Error("boom from a misbehaving callback");
    });
    session.onClose(() => {
      secondCalls += 1;
    });

    // The throwing first callback must not abort the fan-out loop, and must
    // not escape back into Phoenix's onclose dispatch.
    expect(() => instances[0]!.onclose?.()).not.toThrow();
    expect(secondCalls).toBe(1);
  });
});

describe("connectRealtimeGateway — join failure teardown (OSS-473)", () => {
  it("rejects and disconnects the socket when the channel join errors", async () => {
    const { FakeWebSocket, instances } = makeFakeWebSocket("error");

    await expect(
      connectRealtimeGateway({
        wsUrl: "wss://gateway.example/socket",
        apiKey: "cpk-test",
        projectId: 7,
        join: {
          runtimeInstanceId: "rti_1",
          declaredChannels: [{ channelName: "opentag", adapter: "slack" }],
          observedAt: "2026-07-10T00:00:00.000Z",
        },
        webSocket: FakeWebSocket,
      }),
    ).rejects.toThrow(/realtime gateway session join failed/i);

    expect(instances).toHaveLength(1);
    expect(instances[0]!.closed).toBe(true);
  });

  it("renders a non-'undefined' message when the join error reason is undefined", async () => {
    const { FakeWebSocket, instances } = makeFakeWebSocket(
      "error-undefined-reason",
    );

    await expect(
      connectRealtimeGateway({
        wsUrl: "wss://gateway.example/socket",
        apiKey: "cpk-test",
        projectId: 7,
        join: {
          runtimeInstanceId: "rti_1",
          declaredChannels: [{ channelName: "opentag", adapter: "slack" }],
          observedAt: "2026-07-10T00:00:00.000Z",
        },
        webSocket: FakeWebSocket,
      }),
    ).rejects.toThrow(/realtime gateway session join failed: unknown$/);

    expect(instances[0]!.closed).toBe(true);
  });

  it("rejects and disconnects the socket when the channel join times out", async () => {
    const { FakeWebSocket, instances } = makeFakeWebSocket("never");

    await expect(
      connectRealtimeGateway({
        wsUrl: "wss://gateway.example/socket",
        apiKey: "cpk-test",
        projectId: 7,
        join: {
          runtimeInstanceId: "rti_1",
          declaredChannels: [{ channelName: "opentag", adapter: "slack" }],
          observedAt: "2026-07-10T00:00:00.000Z",
        },
        webSocket: FakeWebSocket,
        timeoutMs: 10,
      }),
    ).rejects.toThrow(/realtime gateway session join timed out/i);

    expect(instances).toHaveLength(1);
    expect(instances[0]!.closed).toBe(true);
  });
});
