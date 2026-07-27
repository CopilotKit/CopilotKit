import { describe, expect, it } from "vitest";
import {
  connectRealtimeGateway,
  RealtimeGatewayChannelStateError,
  RealtimeGatewaySetupRequiredError,
  RealtimeGatewayUnreachableError,
} from "./realtime-gateway.js";
import type { RealtimeGatewayConnectionState } from "./realtime-gateway.js";

type JoinMode =
  | "ok"
  | "error"
  | "never"
  | "error-undefined-reason"
  // `channel_declaration_unavailable` where the sole non-live channel is a
  // genuine unconfigured/waiting state → setup_required.
  | "error-setup-required"
  // `channel_declaration_unavailable` with NO channels array — the defensive
  // fallback path (nothing to classify) degrades to setup_required.
  | "error-setup-required-no-channels"
  // `channel_declaration_unavailable` where a non-live channel is a hard-error
  // state (`runtime_conflict`) → must NOT downgrade to setup_required.
  | "error-conflict"
  // `channel_declaration_unavailable` with one waiting AND one hard-error
  // channel → fail loud on the worst (hard error).
  | "error-mixed"
  // Replies `ok` to the FIRST join then never replies to a rejoin — the socket
  // reopens but the (re)join never completes, so the reconnect give-up window
  // can elapse. Used to exercise the `gave_up` transition.
  | "ok-then-silent"
  // Replies `ok` to the FIRST join, then blocks rejoins until `control.recover`
  // is set — exercising a give-up followed by a successful rejoin (recoverable
  // give-up, OSS-473).
  | "give-up-then-recover";

/** Mutable knobs a test can flip after connecting to drive later transitions. */
interface FakeControl {
  /** When set true, `give-up-then-recover` starts replying `ok` to rejoins. */
  recover: boolean;
}

function makeFakeWebSocket(mode: JoinMode) {
  const instances: FakeWebSocket[] = [];
  const control: FakeControl = { recover: false };
  // Shared across the reconnect-spawned instances so `ok-then-silent` /
  // `give-up-then-recover` can tell the initial join from a later rejoin.
  let joinCount = 0;

  /**
   * Build the error `response` payload for a failing join reply. Returning
   * `undefined` omits the `response` key entirely (so it round-trips through
   * JSON as a genuinely absent value — exercising `safeReason(undefined)`).
   */
  function errorResponse(): Record<string, unknown> | undefined {
    switch (mode) {
      case "error-undefined-reason":
        return undefined;
      case "error-setup-required":
        return {
          reason: "channel_declaration_unavailable",
          channels: [{ state: "adapter_setup_required" }],
        };
      case "error-setup-required-no-channels":
        return { reason: "channel_declaration_unavailable" };
      case "error-conflict":
        return {
          reason: "channel_declaration_unavailable",
          channels: [{ state: "runtime_conflict" }],
        };
      case "error-mixed":
        return {
          reason: "channel_declaration_unavailable",
          channels: [
            { state: "adapter_setup_required" },
            { state: "runtime_conflict" },
            { state: "channel_live" },
          ],
        };
      default:
        return { reason: "unauthorized" };
    }
  }

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
    /** Last observed phx_join `joinRef`/`topic`, used by {@link triggerChannelError}. */
    private lastJoinRef: string | undefined;
    private lastTopic: string | undefined;

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
      this.lastJoinRef = joinRef;
      this.lastTopic = topic;
      joinCount += 1;
      const isInitialJoin = joinCount === 1;
      // Modes that go silent on a rejoin so the give-up window can elapse.
      if (!isInitialJoin && mode === "ok-then-silent") return;
      if (
        !isInitialJoin &&
        mode === "give-up-then-recover" &&
        !control.recover
      ) {
        return;
      }
      const isOkMode =
        mode === "ok" ||
        mode === "ok-then-silent" ||
        mode === "give-up-then-recover";
      const status = isOkMode ? "ok" : "error";
      const reply =
        status === "ok"
          ? { status, response: {} }
          : {
              status,
              ...(errorResponse() ? { response: errorResponse() } : {}),
            };
      queueMicrotask(() =>
        this.onmessage?.({
          data: JSON.stringify([joinRef, ref, topic, "phx_reply", reply]),
        }),
      );
    }

    /**
     * Simulate a Phoenix CHANNEL-level error (a `phx_error` for the joined
     * topic) WITHOUT closing the socket. Phoenix marks the channel errored and
     * schedules an auto-rejoin over the still-open socket.
     */
    triggerChannelError(): void {
      if (this.lastJoinRef === undefined || this.lastTopic === undefined)
        return;
      this.onmessage?.({
        data: JSON.stringify([
          this.lastJoinRef,
          null,
          this.lastTopic,
          "phx_error",
          {},
        ]),
      });
    }

    /**
     * Simulate the gateway's explicit generation-fence notification followed by
     * its clean `phx_close`. Phoenix treats that close as terminal and will not
     * auto-rejoin this Channel instance.
     */
    triggerListenerFenced(): void {
      if (this.lastJoinRef === undefined || this.lastTopic === undefined)
        return;
      this.onmessage?.({
        data: JSON.stringify([
          this.lastJoinRef,
          null,
          this.lastTopic,
          "channel.listener_fenced.v1",
          { reason: "listener_activation_fenced" },
        ]),
      });
      this.onmessage?.({
        data: JSON.stringify([
          this.lastJoinRef,
          null,
          this.lastTopic,
          "phx_close",
          {},
        ]),
      });
    }

    close(): void {
      this.closed = true;
      this.readyState = 3;
      this.onclose?.();
    }
  }
  return { FakeWebSocket, instances, control };
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

describe("connectRealtimeGateway — per-channel state classification (OSS-473)", () => {
  it("rejects with a SETUP_REQUIRED-coded error when a non-live channel is genuinely unconfigured", async () => {
    const { FakeWebSocket, instances } = makeFakeWebSocket(
      "error-setup-required",
    );

    const err = await connectRealtimeGateway({
      wsUrl: "wss://gateway.example/socket",
      apiKey: "cpk-test",
      projectId: 7,
      join: {
        runtimeInstanceId: "rti_1",
        declaredChannels: [{ channelName: "opentag", adapter: "slack" }],
        observedAt: "2026-07-10T00:00:00.000Z",
      },
      webSocket: FakeWebSocket,
    }).then(
      () => undefined,
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(RealtimeGatewaySetupRequiredError);
    expect((err as RealtimeGatewaySetupRequiredError).code).toBe(
      "SETUP_REQUIRED",
    );
    // The raw gateway reason is preserved for diagnostics.
    expect((err as RealtimeGatewaySetupRequiredError).reason).toBe(
      "channel_declaration_unavailable",
    );
    // The offending waiting state is preserved for diagnostics.
    expect((err as RealtimeGatewaySetupRequiredError).channelStates).toEqual([
      "adapter_setup_required",
    ]);
    // The socket-leak-teardown behavior is unchanged: a failed join still tears
    // the socket down rather than leaking it.
    expect(instances[0]!.closed).toBe(true);
  });

  it("degrades to SETUP_REQUIRED when channel_declaration_unavailable carries no channel detail", async () => {
    const { FakeWebSocket } = makeFakeWebSocket(
      "error-setup-required-no-channels",
    );

    const err = await connectRealtimeGateway({
      wsUrl: "wss://gateway.example/socket",
      apiKey: "cpk-test",
      projectId: 7,
      join: {
        runtimeInstanceId: "rti_1",
        declaredChannels: [{ channelName: "opentag", adapter: "slack" }],
        observedAt: "2026-07-10T00:00:00.000Z",
      },
      webSocket: FakeWebSocket,
    }).then(
      () => undefined,
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(RealtimeGatewaySetupRequiredError);
    expect((err as RealtimeGatewaySetupRequiredError).channelStates).toEqual(
      [],
    );
  });

  it("does NOT downgrade a runtime_conflict to setup_required — it is a hard error", async () => {
    const { FakeWebSocket, instances } = makeFakeWebSocket("error-conflict");

    const err = await connectRealtimeGateway({
      wsUrl: "wss://gateway.example/socket",
      apiKey: "cpk-test",
      projectId: 7,
      join: {
        runtimeInstanceId: "rti_1",
        declaredChannels: [{ channelName: "opentag", adapter: "slack" }],
        observedAt: "2026-07-10T00:00:00.000Z",
      },
      webSocket: FakeWebSocket,
    }).then(
      () => undefined,
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(RealtimeGatewayChannelStateError);
    // A hard error must NOT carry the SETUP_REQUIRED marker (the manager keys
    // `ready()` off it — a conflict must surface as `error`, not resolve).
    expect((err as { code?: string }).code).not.toBe("SETUP_REQUIRED");
    expect(err).not.toBeInstanceOf(RealtimeGatewaySetupRequiredError);
    // The offending state is preserved for diagnostics.
    expect((err as RealtimeGatewayChannelStateError).channelStates).toEqual([
      "runtime_conflict",
    ]);
    expect((err as Error).message).toMatch(/runtime_conflict/);
    expect(instances[0]!.closed).toBe(true);
  });

  it("fails loud on the worst state when waiting and hard-error channels are mixed", async () => {
    const { FakeWebSocket } = makeFakeWebSocket("error-mixed");

    const err = await connectRealtimeGateway({
      wsUrl: "wss://gateway.example/socket",
      apiKey: "cpk-test",
      projectId: 7,
      join: {
        runtimeInstanceId: "rti_1",
        declaredChannels: [{ channelName: "opentag", adapter: "slack" }],
        observedAt: "2026-07-10T00:00:00.000Z",
      },
      webSocket: FakeWebSocket,
    }).then(
      () => undefined,
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(RealtimeGatewayChannelStateError);
    // Only the hard-error state(s) are surfaced (channel_live is dropped, and
    // the waiting adapter_setup_required is subsumed by the louder failure).
    expect((err as RealtimeGatewayChannelStateError).channelStates).toEqual([
      "runtime_conflict",
    ]);
  });
});

/** Poll until `pred` holds or the deadline elapses (drives real Phoenix reconnect timers). */
async function waitUntil(pred: () => boolean, ms = 2000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!pred() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("connectRealtimeGateway — connection-health state (OSS-473)", () => {
  it("transitions to reconnecting on an unexpected drop and back to online on a successful rejoin", async () => {
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

    const states: RealtimeGatewayConnectionState[] = [];
    session.onStateChange((s) => states.push(s));

    // Unexpected transport drop — Phoenix begins retrying.
    instances[0]!.onclose?.();
    expect(states).toContain("reconnecting");

    // Phoenix auto-reconnects (a fresh socket) and auto-rejoins; the ok reply to
    // the rejoin re-fires the join-push "ok" hook, restoring online.
    await waitUntil(() => states.includes("online"));
    expect(states[states.length - 1]).toBe("online");

    session.disconnect();
  });

  it("transitions to reconnecting on a channel-level error while the socket stays open, then back to online on channel rejoin", async () => {
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

    const states: RealtimeGatewayConnectionState[] = [];
    session.onStateChange((s) => states.push(s));

    // A Phoenix CHANNEL-level error with the socket still open — pushes can't
    // send, so health must fall to reconnecting even though the socket lives.
    instances[0]!.triggerChannelError();
    await waitUntil(() => states.includes("reconnecting"));
    expect(states).toContain("reconnecting");
    // The socket itself never dropped: same instance, still open.
    expect(instances).toHaveLength(1);
    expect(instances[0]!.closed).toBe(false);

    // Phoenix auto-rejoins the errored channel over the still-open socket; the
    // ok reply restores online.
    await waitUntil(() => states.includes("online"), 8000);
    expect(states[states.length - 1]).toBe("online");

    session.disconnect();
  });

  it("surfaces a superseded listener as fenced instead of pretending Phoenix will rejoin it", async () => {
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

    const states: string[] = [];
    session.onStateChange((state) => states.push(state));

    instances[0]!.triggerListenerFenced();

    expect(states).toEqual(["fenced"]);
    expect(
      instances[0]!.frames.filter(
        (frame) => Array.isArray(frame) && frame[3] === "phx_join",
      ),
    ).toHaveLength(1);

    session.disconnect();
  });

  it("gives up (emits gave_up) when the reconnect window elapses without a successful rejoin", async () => {
    const { FakeWebSocket, instances } = makeFakeWebSocket("ok-then-silent");
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
      reconnectGiveUpMs: 40,
    });

    const states: RealtimeGatewayConnectionState[] = [];
    session.onStateChange((s) => states.push(s));

    // Drop: the socket reopens but the rejoin never completes (silent), so the
    // give-up window bounds the retry and the session declares the link dead.
    instances[0]!.onclose?.();
    await waitUntil(() => states.includes("gave_up"));

    expect(states).toContain("reconnecting");
    expect(states[states.length - 1]).toBe("gave_up");

    session.disconnect();
  });

  it("recovers to online after gave_up when the gateway returns — gave_up is not terminal", async () => {
    const { FakeWebSocket, instances, control } = makeFakeWebSocket(
      "give-up-then-recover",
    );
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
      // Small window so give-up fires fast; small push timeout so silent rejoins
      // time out quickly and Phoenix retries the channel on a tight cadence.
      reconnectGiveUpMs: 40,
      timeoutMs: 50,
    });

    const states: RealtimeGatewayConnectionState[] = [];
    session.onStateChange((s) => states.push(s));

    // Drop; rejoins stay silent, so the give-up window elapses → gave_up.
    instances[0]!.onclose?.();
    await waitUntil(() => states.includes("gave_up"));
    expect(states).toContain("gave_up");

    // The gateway returns: subsequent rejoins now succeed. A give-up must be
    // recoverable — the next successful rejoin restores online.
    control.recover = true;
    await waitUntil(() => states[states.length - 1] === "online", 8000);
    expect(states[states.length - 1]).toBe("online");

    session.disconnect();
  });

  it("keeps gave_up sticky until a successful rejoin, then re-arms for a fresh drop (OSS-473)", async () => {
    const { FakeWebSocket, instances, control } = makeFakeWebSocket(
      "give-up-then-recover",
    );
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
      // Small window so give-up fires fast; small push timeout so silent rejoins
      // time out quickly and Phoenix retries the channel on a tight cadence.
      reconnectGiveUpMs: 40,
      timeoutMs: 50,
    });

    const states: RealtimeGatewayConnectionState[] = [];
    session.onStateChange((s) => states.push(s));

    // (a) Long outage: drop, rejoins stay silent → reconnecting → gave_up, and
    // it STAYS. A subsequent FAILED retry during the SAME outage must NOT
    // re-emit reconnecting — gave_up is sticky until a successful rejoin.
    instances[0]!.onclose?.();
    await waitUntil(() => states.includes("gave_up"));
    expect(states).toContain("reconnecting");
    expect(states[states.length - 1]).toBe("gave_up");

    const afterGaveUp = states.length;
    // A failed retry: Phoenix errors the channel over the still-open socket.
    instances[instances.length - 1]!.triggerChannelError();
    // Give any queued rejoin/timeout microtasks a chance to (wrongly) re-emit.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(states.slice(afterGaveUp)).not.toContain("reconnecting");
    expect(states[states.length - 1]).toBe("gave_up");

    // (b) Only a successful rejoin may restore online. The gateway returns.
    control.recover = true;
    await waitUntil(() => states[states.length - 1] === "online", 8000);
    expect(states[states.length - 1]).toBe("online");

    // (c) Recovery re-armed the latch: a FRESH drop after recovery enters
    // reconnecting again (enterReconnecting emits synchronously on the drop).
    const afterRecovery = states.length;
    instances[instances.length - 1]!.onclose?.();
    expect(states.slice(afterRecovery)).toContain("reconnecting");

    session.disconnect();
  });

  it("does not emit a connection-state transition for our own disconnect()", async () => {
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

    const states: RealtimeGatewayConnectionState[] = [];
    session.onStateChange((s) => states.push(s));

    session.disconnect();

    expect(instances[0]!.closed).toBe(true);
    expect(states).toEqual([]);
  });
});

/**
 * Transport-level failure modes for a socket that never opens. Before OSS-623
 * every one of these looked identical to the caller: an opaque hang that only
 * surfaced as the supervising manager's settle timeout.
 */
type TransportFailure =
  // NXDOMAIN — the configured host does not exist. Retrying cannot fix it.
  | "dns"
  // The host resolves but nothing is listening — possibly a boot race.
  | "refused"
  // A browser-style detail-free `Event` (no code, no message).
  | "opaque"
  // The connect neither opens nor errors (black-holed IP / dropped SYN).
  | "silent";

/** The `error` event a real WebSocket surfaces for `failure`. */
function transportErrorEvent(failure: TransportFailure): unknown {
  switch (failure) {
    case "dns":
      // Node's WebSocket wraps the resolver failure as the error event's
      // underlying `error`; ENOTFOUND is NXDOMAIN — the host does not exist.
      return {
        type: "error",
        message: "connection error",
        error: Object.assign(
          new Error("getaddrinfo ENOTFOUND realtime.copilotkit.ai"),
          { code: "ENOTFOUND" },
        ),
      };
    case "refused":
      return {
        type: "error",
        message: "connection error",
        error: Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:4001"), {
          code: "ECONNREFUSED",
        }),
      };
    default:
      return { type: "error" };
  }
}

/**
 * A WebSocket whose first `openAfter - 1` connection attempts fail with
 * `failure`; the attempt at `openAfter` (default: never) opens normally and
 * replies `ok` to the channel join, modeling a gateway that was still booting.
 */
function makeFailingWebSocket(
  failure: TransportFailure,
  opts: { openAfter?: number } = {},
) {
  const instances: FailingWebSocket[] = [];

  class FailingWebSocket {
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

    constructor(public readonly url: string) {
      instances.push(this);
      const attempt = instances.length;
      queueMicrotask(() => {
        if (opts.openAfter !== undefined && attempt >= opts.openAfter) {
          this.readyState = 1;
          this.onopen?.();
          return;
        }
        if (failure === "silent") return;
        this.readyState = 3;
        this.onerror?.(transportErrorEvent(failure));
        // A failed connect closes uncleanly (1006), which is what drives
        // Phoenix's reconnect timer — the retry-forever behavior under test.
        this.onclose?.({ code: 1006, wasClean: false });
      });
    }

    send(data: string): void {
      let frame: unknown;
      try {
        frame = JSON.parse(data);
      } catch {
        return;
      }
      if (!Array.isArray(frame)) return;
      const [joinRef, ref, topic, event] = frame as [
        string,
        string,
        string,
        string,
      ];
      if (event !== "phx_join") return;
      queueMicrotask(() =>
        this.onmessage?.({
          data: JSON.stringify([
            joinRef,
            ref,
            topic,
            "phx_reply",
            { status: "ok", response: {} },
          ]),
        }),
      );
    }

    close(): void {
      this.closed = true;
      this.readyState = 3;
      this.onclose?.();
    }
  }
  return { FailingWebSocket, instances };
}

const JOIN = {
  runtimeInstanceId: "rti_1",
  declaredChannels: [{ channelName: "opentag", adapter: "slack" }],
  observedAt: "2026-07-10T00:00:00.000Z",
};

describe("connectRealtimeGateway — unreachable gateway host (OSS-623)", () => {
  it("fails immediately with the DNS cause when the host does not resolve", async () => {
    const { FailingWebSocket, instances } = makeFailingWebSocket("dns");

    const started = Date.now();
    const err = await connectRealtimeGateway({
      wsUrl: "wss://realtime.copilotkit.ai/runner",
      apiKey: "cpk-test",
      projectId: 7,
      join: JOIN,
      webSocket: FailingWebSocket,
      // Generous deadline: an NXDOMAIN host must NOT burn it — the name does
      // not exist, and no amount of retrying will make it exist.
      connectTimeoutMs: 5_000,
    }).then(
      () => undefined,
      (e: unknown) => e,
    );
    const elapsed = Date.now() - started;

    expect(err).toBeInstanceOf(RealtimeGatewayUnreachableError);
    expect(elapsed).toBeLessThan(1_000);
    // The message must point at the misconfigured host and the real cause,
    // not at a stopwatch.
    expect((err as Error).message).toMatch(/wss:\/\/realtime\.copilotkit\.ai/);
    expect((err as Error).message).toMatch(/ENOTFOUND/);
    expect((err as RealtimeGatewayUnreachableError).endpoint).toBe(
      "wss://realtime.copilotkit.ai/runner",
    );
    // A misconfigured host is NOT a setup-waiting condition: it must reject
    // `ready()`, never resolve as `setup_required` (coordinated with OSS-622).
    expect(err).not.toBeInstanceOf(RealtimeGatewaySetupRequiredError);
    expect((err as { code?: string }).code).not.toBe("SETUP_REQUIRED");
    // The socket must not be left retrying a host that will never resolve.
    expect(instances.every((instance) => instance.closed)).toBe(true);
  });

  it("gives up at the connect deadline with the transport cause when the connection is refused", async () => {
    const { FailingWebSocket } = makeFailingWebSocket("refused");

    const started = Date.now();
    const err = await connectRealtimeGateway({
      wsUrl: "wss://gateway.example/runner",
      apiKey: "cpk-test",
      projectId: 7,
      join: JOIN,
      webSocket: FailingWebSocket,
      connectTimeoutMs: 150,
    }).then(
      () => undefined,
      (e: unknown) => e,
    );
    const elapsed = Date.now() - started;

    expect(err).toBeInstanceOf(RealtimeGatewayUnreachableError);
    // A refusal may just be a gateway that has not booted yet, so it is given
    // the full (short) connect window rather than failing on the first error.
    expect(elapsed).toBeGreaterThanOrEqual(140);
    expect((err as Error).message).toMatch(/wss:\/\/gateway\.example/);
    expect((err as Error).message).toMatch(/ECONNREFUSED/);
  });

  it("rejects at the connect deadline when the connect hangs with no transport event at all", async () => {
    const { FailingWebSocket } = makeFailingWebSocket("silent");

    const err = await connectRealtimeGateway({
      wsUrl: "wss://gateway.example/runner",
      apiKey: "cpk-test",
      projectId: 7,
      join: JOIN,
      webSocket: FailingWebSocket,
      connectTimeoutMs: 150,
      // Far larger than the connect deadline: a black-holed connect must be
      // bounded by the CONNECT budget, not by the join timeout.
      timeoutMs: 60_000,
    }).then(
      () => undefined,
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(RealtimeGatewayUnreachableError);
    expect((err as Error).message).toMatch(/wss:\/\/gateway\.example/);
    expect(
      (err as RealtimeGatewayUnreachableError).transportError,
    ).toBeUndefined();
  });

  it("still names the endpoint when the transport error carries no detail", async () => {
    const { FailingWebSocket } = makeFailingWebSocket("opaque");

    const err = await connectRealtimeGateway({
      wsUrl: "wss://gateway.example/runner",
      apiKey: "cpk-test",
      projectId: 7,
      join: JOIN,
      webSocket: FailingWebSocket,
      connectTimeoutMs: 150,
    }).then(
      () => undefined,
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(RealtimeGatewayUnreachableError);
    expect((err as Error).message).toMatch(/wss:\/\/gateway\.example\/runner/);
  });

  it("does not fail a gateway that is merely still booting", async () => {
    // The first connect attempt is refused; the second succeeds — the boot
    // race a fail-on-first-error rule would turn into a permanent activation
    // failure (the manager does not retry activation).
    const { FailingWebSocket, instances } = makeFailingWebSocket("refused", {
      openAfter: 2,
    });

    const session = await connectRealtimeGateway({
      wsUrl: "wss://gateway.example/runner",
      apiKey: "cpk-test",
      projectId: 7,
      join: JOIN,
      webSocket: FailingWebSocket,
      connectTimeoutMs: 2_000,
    });

    expect(instances.length).toBeGreaterThanOrEqual(2);
    session.disconnect();
  });

  it("disarms the connect deadline once connected — a later drop is a reconnect, not an unreachable host", async () => {
    const { FakeWebSocket, instances } = makeFakeWebSocket("ok");
    const session = await connectRealtimeGateway({
      wsUrl: "wss://gateway.example/runner",
      apiKey: "cpk-test",
      projectId: 7,
      join: JOIN,
      webSocket: FakeWebSocket,
      connectTimeoutMs: 30,
    });

    const states: RealtimeGatewayConnectionState[] = [];
    session.onStateChange((s) => states.push(s));

    // Drop AFTER a successful connect, then wait past the (already elapsed)
    // connect deadline: the session must treat this as a reconnect episode and
    // must not tear itself down as "never connected".
    instances[0]!.onclose?.();
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(states).toContain("reconnecting");
    await waitUntil(() => states.includes("online"));
    expect(states[states.length - 1]).toBe("online");

    session.disconnect();
  });
});
