import { describe, it, expect } from "vitest";
import { createChannel, FakeAgent } from "@copilotkit/channels";
import { Section } from "@copilotkit/channels-ui";
import {
  startChannelsWithGatewaySession,
  startChannelsOverRealtimeGateway,
} from "./realtime-gateway-launcher.js";
import type { RealtimeGatewaySession } from "./realtime-gateway.js";

const scope = {
  organizationId: "org_1",
  projectId: 7,
  channelId: "channel_1",
  channelName: "opentag",
};

/** Fake gateway session: records pushes, replies `render_accepted`, and exposes
 * the server-push handlers so a test can simulate `delivery.available`. */
function makeFakeSession() {
  const pushes: { event: string; payload: unknown }[] = [];
  const handlers = new Map<string, (payload: unknown) => void>();
  const session: RealtimeGatewaySession = {
    push: async (event, payload) => {
      pushes.push({ event, payload });
      if (event === "channel.render_event.v1") {
        const p = (payload as { payload: Record<string, unknown> }).payload;
        return {
          type: "channel.render_accepted.v1",
          occurredAt: "2026-07-09T00:00:00.000Z",
          payload: {
            idempotencyKey: p.idempotencyKey,
            acceptance: "accepted",
            ...(p.event && (p.event as { kind: string }).kind === "finalize"
              ? { egressOperationId: "eop_1" }
              : {}),
          },
        };
      }
      return { status: "ok" };
    },
    on: (event, handler) => {
      handlers.set(event, handler);
    },
  };
  return { session, pushes, handlers };
}

/** Simulate one leased text-turn delivery arriving over the gateway session. */
function deliverText(handlers: Map<string, (p: unknown) => void>) {
  handlers.get("channel.delivery.available.v1")?.({
    payload: {
      delivery: {
        id: "dlv_1",
        leaseToken: "lease_1",
        adapter: "slack",
        channel: { id: "channel_1", name: "opentag" },
        turn: {
          id: "turn_1",
          eventId: "evt_1",
          replyTarget: { adapter: "slack", teamId: "T1", channel: "C1" },
          input: { kind: "text", text: "hi" },
        },
      },
    },
  });
}

/** The gateway session `delivery.available` handler is fire-and-forget, so poll until
 * the async dispatch→render→ack chain has produced the terminal event. */
async function waitFor(pred: () => boolean, tries = 50): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 0));
  }
  throw new Error("waitFor: condition not met within the poll window");
}

describe("startChannelsWithGatewaySession — Channel runtime over Realtime Gateway (OSS-406)", () => {
  it("runs a delivered turn end-to-end: handler → render frame → completion intent, never self-ack", async () => {
    const fake = makeFakeSession();
    let ran = false;
    const bot = createChannel({
      name: "opentag",
      agent: () => new FakeAgent(),
    });
    bot.onMessage(async ({ thread }) => {
      ran = true;
      await thread.post(Section({ children: "reply" }));
    });

    const handle = await startChannelsWithGatewaySession([bot], {
      session: fake.session,
      scope,
      runtimeInstanceId: "rti_1",
    });

    deliverText(fake.handlers);
    await waitFor(() =>
      fake.pushes.some(
        (p) => p.event === "channel.delivery.complete_requested.v1",
      ),
    );

    const events = fake.pushes.map((p) => p.event);
    expect(ran).toBe(true); // the Channel handler ran off a gateway-delivered turn
    expect(events).toContain("channel.render_event.v1"); // rendered over the gateway session
    expect(events).toContain("channel.delivery.complete_requested.v1"); // completion INTENT
    expect(events).not.toContain("channel.delivery.ack.v1"); // SDK never commits the ack

    await handle.stop();
  });

  it("nacks (fail intent) when the handler throws — no completion intent, no self-ack", async () => {
    const fake = makeFakeSession();
    const bot = createChannel({
      name: "opentag",
      agent: () => new FakeAgent(),
    });
    bot.onMessage(async () => {
      throw new Error("boom");
    });

    const handle = await startChannelsWithGatewaySession([bot], {
      session: fake.session,
      scope,
      runtimeInstanceId: "rti_1",
    });

    deliverText(fake.handlers);
    await waitFor(() =>
      fake.pushes.some((p) => p.event === "channel.delivery.fail.v1"),
    );

    const events = fake.pushes.map((p) => p.event);
    expect(events).toContain("channel.delivery.fail.v1");
    expect(events).not.toContain("channel.delivery.complete_requested.v1");
    expect(events).not.toContain("channel.delivery.ack.v1");

    await handle.stop();
  });
});

describe("startChannelsOverRealtimeGateway — fail-fast validation (OSS-406)", () => {
  it("rejects an invalid Channel scope before opening a socket", async () => {
    let socketConstructed = false;
    class NeverWebSocket {
      constructor() {
        socketConstructed = true;
        throw new Error(
          "startChannelsOverRealtimeGateway should not have connected",
        );
      }
    }
    const bot = createChannel({
      name: "opentag",
      agent: () => new FakeAgent(),
    });

    await expect(
      startChannelsOverRealtimeGateway([bot], {
        wsUrl: "wss://gateway.example/socket",
        apiKey: "cpk-test",
        scope: { ...scope, channelId: "bot_1" },
        runtimeInstanceId: "rti_1",
        webSocket: NeverWebSocket,
      }),
    ).rejects.toThrow(/channel_\* channelId/i);

    expect(socketConstructed).toBe(false);
  });

  it("rejects a bad bot name before opening a socket (no leaked connection)", async () => {
    let socketConstructed = false;
    class NeverWebSocket {
      constructor() {
        socketConstructed = true;
        throw new Error(
          "startChannelsOverRealtimeGateway should not have connected",
        );
      }
    }
    const a = createChannel({ name: "dupe", agent: () => new FakeAgent() });
    const b = createChannel({ name: "dupe", agent: () => new FakeAgent() });

    await expect(
      startChannelsOverRealtimeGateway([a, b], {
        wsUrl: "wss://gateway.example/socket",
        apiKey: "cpk-test",
        scope,
        runtimeInstanceId: "rti_1",
        webSocket: NeverWebSocket,
      }),
    ).rejects.toThrow(/duplicate channel name/i);

    expect(socketConstructed).toBe(false);
  });

  it("rejects >1 Channel before opening a socket (Phase 1 is single-Channel per gateway session)", async () => {
    let socketConstructed = false;
    class NeverWebSocket {
      constructor() {
        socketConstructed = true;
        throw new Error(
          "startChannelsOverRealtimeGateway should not have connected",
        );
      }
    }
    const a = createChannel({ name: "one", agent: () => new FakeAgent() });
    const b = createChannel({ name: "two", agent: () => new FakeAgent() });

    await expect(
      startChannelsOverRealtimeGateway([a, b], {
        wsUrl: "wss://gateway.example/socket",
        apiKey: "cpk-test",
        scope,
        runtimeInstanceId: "rti_1",
        webSocket: NeverWebSocket,
      }),
    ).rejects.toThrow(/exactly one Channel per gateway session/i);

    expect(socketConstructed).toBe(false);
  });

  it("startChannelsWithGatewaySession also rejects >1 Channel (shared-transport misrouting guard)", async () => {
    const fake = makeFakeSession();
    const a = createChannel({ name: "one", agent: () => new FakeAgent() });
    const b = createChannel({ name: "two", agent: () => new FakeAgent() });

    await expect(
      startChannelsWithGatewaySession([a, b], {
        session: fake.session,
        scope,
        runtimeInstanceId: "rti_1",
      }),
    ).rejects.toThrow(/exactly one Channel per gateway session/i);
  });
});

describe("startChannelsWithGatewaySession — activation metadata (OSS-406)", () => {
  it("forwards env overrides into handle.metadata (keeps join ↔ metadata in sync)", async () => {
    const fake = makeFakeSession();
    const bot = createChannel({
      name: "opentag",
      agent: () => new FakeAgent(),
    });

    const handle = await startChannelsWithGatewaySession([bot], {
      session: fake.session,
      scope,
      runtimeInstanceId: "rti_1",
      env: { runtimeEnv: "production", runtimePackageVersion: "9.9.9" },
    });

    expect(handle.metadata.runtimeEnv).toBe("production");
    expect(handle.metadata.runtimePackageVersion).toBe("9.9.9");
    expect(handle.metadata.declaredChannelNames).toEqual(["opentag"]);

    await handle.stop();
  });

  it("keeps the required runtimeInstanceId authoritative in handle.metadata", async () => {
    const fake = makeFakeSession();
    const bot = createChannel({
      name: "opentag",
      agent: () => new FakeAgent(),
    });

    const handle = await startChannelsWithGatewaySession([bot], {
      session: fake.session,
      scope,
      runtimeInstanceId: "rti_authoritative",
      env: { runtimeEnv: "staging" },
    });

    expect(handle.metadata.runtimeInstanceId).toBe("rti_authoritative");

    await handle.stop();
  });
});

/**
 * Minimal gateway-compatible fake WebSocket that drives the v2-serializer join
 * handshake so the connector's error/timeout cleanup can be exercised without a
 * real gateway. `mode` controls the phx_join reply: "ok" → joined, "error" →
 * rejected, "never" → no reply (the channel join times out). Records `close()`
 * so a test can assert the socket was torn down.
 */
type JoinMode = "ok" | "error" | "never";
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
      if (!Array.isArray(frame)) return;
      const [joinRef, ref, topic, event] = frame as [
        string,
        string,
        string,
        string,
      ];
      if (event !== "phx_join") return;
      const status = mode === "ok" ? "ok" : "error";
      const response = mode === "ok" ? {} : { reason: "unauthorized" };
      const reply = JSON.stringify([
        joinRef,
        ref,
        topic,
        "phx_reply",
        { status, response },
      ]);
      queueMicrotask(() => this.onmessage?.({ data: reply }));
    }
    close(): void {
      this.closed = true;
      this.readyState = 3;
      this.onclose?.();
    }
  }
  return { FakeWebSocket, instances };
}

describe("startChannelsOverRealtimeGateway — socket lifecycle cleanup (OSS-406)", () => {
  it("disconnects the socket when the channel join times out", async () => {
    const { FakeWebSocket, instances } = makeFakeWebSocket("never");
    const bot = createChannel({
      name: "opentag",
      agent: () => new FakeAgent(),
    });

    await expect(
      startChannelsOverRealtimeGateway([bot], {
        wsUrl: "wss://gateway.example/socket",
        apiKey: "cpk-test",
        scope,
        runtimeInstanceId: "rti_1",
        webSocket: FakeWebSocket,
        timeoutMs: 20,
      }),
    ).rejects.toThrow(/timed out/i);

    expect(instances.length).toBe(1);
    expect(instances[0]!.closed).toBe(true);
  });

  it("disconnects the socket when the channel join is rejected", async () => {
    const { FakeWebSocket, instances } = makeFakeWebSocket("error");
    const bot = createChannel({
      name: "opentag",
      agent: () => new FakeAgent(),
    });

    await expect(
      startChannelsOverRealtimeGateway([bot], {
        wsUrl: "wss://gateway.example/socket",
        apiKey: "cpk-test",
        scope,
        runtimeInstanceId: "rti_1",
        webSocket: FakeWebSocket,
        timeoutMs: 1000,
      }),
    ).rejects.toThrow(/join failed/i);

    expect(instances.length).toBe(1);
    expect(instances[0]!.closed).toBe(true);
  });

  it("disconnects the socket when bot startup fails after the channel joined", async () => {
    const { FakeWebSocket, instances } = makeFakeWebSocket("ok");
    // Pre-start the Channel so startChannels' addAdapter() throws ("adapter added
    // after start") during the post-join startup — the exact failure the
    // launcher's try/catch must clean up after.
    const started = makeFakeSession();
    const bot = createChannel({
      name: "opentag",
      agent: () => new FakeAgent(),
    });
    const first = await startChannelsWithGatewaySession([bot], {
      session: started.session,
      scope,
      runtimeInstanceId: "rti_pre",
    });

    await expect(
      startChannelsOverRealtimeGateway([bot], {
        wsUrl: "wss://gateway.example/socket",
        apiKey: "cpk-test",
        scope,
        runtimeInstanceId: "rti_1",
        webSocket: FakeWebSocket,
        timeoutMs: 1000,
      }),
    ).rejects.toThrow();

    expect(instances.length).toBe(1);
    expect(instances[0]!.closed).toBe(true);

    await first.stop();
  });
});
