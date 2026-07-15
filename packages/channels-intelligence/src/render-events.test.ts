import { describe, it, expect, vi } from "vitest";
import type { ReplyTarget } from "@copilotkit/channels";
import { intelligenceAdapter } from "./intelligence-adapter.js";
import {
  InMemoryDeliverySource,
  InMemoryEgressSink,
  InMemoryRenderEventSink,
} from "./in-memory-transports.js";
import { RealtimeGatewayTransport } from "./realtime-gateway-transport.js";
import type { RealtimeGatewaySession } from "./realtime-gateway.js";

const target = {
  route: { channel: "C1", threadTs: "100.0" },
  turnId: "turn_t1",
  deliveryId: "dlv_d1",
} as unknown as ReplyTarget;

/** Drive a subscriber handler that may be sync or async. */
type Sub = Record<string, (p: { event: Record<string, unknown> }) => unknown>;

describe("run renderer — render-event streaming (OSS-402)", () => {
  it("mints ordered render frames with monotonic seq per (turn, slot) and a finalize", async () => {
    const renderSink = new InMemoryRenderEventSink();
    const adapter = intelligenceAdapter({
      source: new InMemoryDeliverySource(),
      egress: new InMemoryEgressSink(),
      renderSink,
    });
    const renderer = adapter.createRunRenderer(target);
    const sub = renderer.subscriber as unknown as Sub;

    sub.onTextMessageContentEvent?.({
      event: { messageId: "m1", delta: "hello " },
    });
    sub.onTextMessageContentEvent?.({
      event: { messageId: "m1", delta: "world" },
    });
    await sub.onToolCallStartEvent?.({
      event: { toolCallId: "tc1", toolCallName: "search" },
    });
    await sub.onToolCallEndEvent?.({
      event: { toolCallId: "tc1" },
      toolCallName: "search",
      toolCallArgs: {},
    } as never);
    await sub.onTextMessageEndEvent?.({ event: { messageId: "m1" } });
    await renderer.finish?.();

    const kinds = renderSink.frames.map((f) => f.event.kind);
    expect(kinds).toEqual([
      "run_started",
      "text_delta",
      "text_delta",
      "tool_start",
      "tool_end",
      "text_end",
      "finalize",
    ]);
    // seq is monotonic and zero-based within (turn, slot).
    expect(renderSink.frames.map((f) => f.seq)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(renderSink.frames.every((f) => f.slot === "main")).toBe(true);
    expect(renderSink.frames.every((f) => f.turnId === "turn_t1")).toBe(true);
  });

  it("markInterrupted emits an interrupt frame then a finalize", async () => {
    const renderSink = new InMemoryRenderEventSink();
    const adapter = intelligenceAdapter({
      source: new InMemoryDeliverySource(),
      egress: new InMemoryEgressSink(),
      renderSink,
    });
    const renderer = adapter.createRunRenderer(target);
    const sub = renderer.subscriber as unknown as Sub;
    sub.onTextMessageContentEvent?.({
      event: { messageId: "m1", delta: "partial" },
    });
    await renderer.markInterrupted();

    const kinds = renderSink.frames.map((f) => f.event.kind);
    expect(kinds).toEqual([
      "run_started",
      "text_delta",
      "interrupt",
      "finalize",
    ]);
  });

  it("routes a discrete post through a post render frame (rich IR preserved) when a renderSink is wired", async () => {
    const renderSink = new InMemoryRenderEventSink();
    const adapter = intelligenceAdapter({
      source: new InMemoryDeliverySource(),
      egress: new InMemoryEgressSink(),
      renderSink,
    });
    const card = [
      { type: "section", props: { children: "card" } },
    ] as unknown as Parameters<typeof adapter.post>[1];

    await adapter.post(target, card);

    const postFrame = renderSink.frames.find((f) => f.event.kind === "post");
    expect(postFrame).toBeDefined();
    expect(postFrame?.slot).toBe("main");
    expect(
      (postFrame?.event as { kind: "post"; content: unknown }).content,
    ).toEqual(card);
  });

  it("falls back to a single post op on the EgressSink when no renderSink is wired", async () => {
    const egress = new InMemoryEgressSink();
    const adapter = intelligenceAdapter({
      source: new InMemoryDeliverySource(),
      egress,
    });
    const renderer = adapter.createRunRenderer(target);
    const sub = renderer.subscriber as unknown as Sub;
    sub.onTextMessageContentEvent?.({
      event: { messageId: "m1", delta: "hello " },
    });
    sub.onTextMessageContentEvent?.({
      event: { messageId: "m1", delta: "world" },
    });
    await sub.onTextMessageEndEvent?.({ event: { messageId: "m1" } });
    await renderer.finish?.();

    expect(egress.ops).toHaveLength(1);
    expect(egress.ops[0]!.op.kind).toBe("post");
  });
});

/** A fake Realtime Gateway session that records pushes and replies with render_accepted. */
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
          occurredAt: "2026-07-01T00:00:00.000Z",
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

describe("RealtimeGatewayTransport — completion intent, never self-ack", () => {
  const cfg = (session: RealtimeGatewaySession) => ({
    scope: {
      organizationId: "org_1",
      projectId: 7,
      channelId: "channel_1",
      channelName: "support",
    },
    runtimeInstanceId: "rti_1",
    session,
    now: () => "2026-07-01T00:00:00.000Z",
  });

  it("streams render frames, awaits receipts, then sends complete_requested (not ack)", async () => {
    const fake = makeFakeSession();
    const t = new RealtimeGatewayTransport(cfg(fake.session));

    // Simulate a leased delivery arriving over the gateway session.
    let delivered = false;
    await t.start(async () => {
      delivered = true;
    });
    fake.handlers.get("channel.delivery.available.v1")?.({
      payload: {
        delivery: {
          id: "dlv_d1",
          leaseToken: "lease_l1",
          adapter: "slack",
          channel: { id: "channel_1", name: "support" },
          turn: {
            id: "turn_t1",
            eventId: "evt_1",
            replyTarget: { adapter: "slack", teamId: "T1", channel: "C1" },
            input: { kind: "text", text: "hi" },
          },
        },
      },
    });
    // handler is async (void); give the microtask queue a turn.
    await Promise.resolve();
    expect(delivered).toBe(true);

    const r1 = await t.push({
      deliveryId: "dlv_d1",
      turnId: "turn_t1",
      slot: "main",
      seq: 0,
      event: { kind: "run_started" },
    });
    expect(r1.acceptance).toBe("accepted");
    expect(r1.idempotencyKey).toBe("turn_t1:main:0");

    const rFinal = await t.push({
      deliveryId: "dlv_d1",
      turnId: "turn_t1",
      slot: "main",
      seq: 1,
      event: { kind: "finalize" },
    });
    expect(rFinal.egressOperationId).toBe("eop_1");

    await t.ack("dlv_d1");

    const events = fake.pushes.map((p) => p.event);
    // render frames first, then the completion INTENT.
    expect(events).toEqual([
      "channel.render_event.v1",
      "channel.render_event.v1",
      "channel.delivery.complete_requested.v1",
    ]);
    // The SDK must NEVER emit a committed delivery ack.
    expect(events).not.toContain("channel.delivery.ack.v1");

    const completion = fake.pushes.at(-1)!.payload as {
      payload: {
        acceptedThrough: unknown[];
        runtimeInstanceId: string;
        leaseToken?: string;
      };
    };
    expect(completion.payload.acceptedThrough).toEqual([
      { turnId: "turn_t1", slot: "main", seq: 1 },
    ]);
    expect(completion.payload.runtimeInstanceId).toBe("rti_1");
    // OSS-446: render-accept + completion intent are both fenced on the lease.
    const render = fake.pushes.find(
      (p) => p.event === "channel.render_event.v1",
    )!.payload as { payload: { leaseToken?: string } };
    expect(render.payload.leaseToken).toBe("lease_l1");
    expect(completion.payload.leaseToken).toBe("lease_l1");
  });

  it("throws if a render frame is not accepted (no silent success)", async () => {
    const fake = makeFakeSession();
    // Override push to reply with a non-accepted envelope.
    const session: RealtimeGatewaySession = {
      push: async () => ({ type: "channel.something_else.v1" }),
      on: fake.session.on,
    };
    const t = new RealtimeGatewayTransport(cfg(session));
    await expect(
      t.push({
        deliveryId: "dlv_d1",
        turnId: "turn_t1",
        slot: "main",
        seq: 0,
        event: { kind: "run_started" },
      }),
    ).rejects.toThrow(/render_accepted/);
  });

  it("nack sends a fail event, never an ack", async () => {
    const fake = makeFakeSession();
    const t = new RealtimeGatewayTransport(cfg(fake.session));
    await t.start(async () => {});
    fake.handlers.get("channel.delivery.available.v1")?.({
      payload: {
        delivery: {
          id: "dlv_d1",
          leaseToken: "lease_l1",
          adapter: "slack",
          channel: { id: "channel_1", name: "support" },
          turn: {
            id: "turn_t1",
            eventId: "evt_1",
            input: { kind: "text", text: "hi" },
          },
        },
      },
    });
    await Promise.resolve();
    await t.nack("dlv_d1", "boom");
    const events = fake.pushes.map((p) => p.event);
    expect(events).toContain("channel.delivery.fail.v1");
    expect(events).not.toContain("channel.delivery.ack.v1");
    const fail = fake.pushes.find(
      (p) => p.event === "channel.delivery.fail.v1",
    );
    expect(
      (fail?.payload as { payload?: { leaseToken?: string } }).payload
        ?.leaseToken,
    ).toBe("lease_l1");
  });

  it("nacks and logs when the onDelivery handler throws (dispatch error-boundary)", async () => {
    const fake = makeFakeSession();
    const logs: string[] = [];
    const t = new RealtimeGatewayTransport({
      ...cfg(fake.session),
      log: (m) => logs.push(m),
    });
    // A handler that rejects. Before the fix this dispatched via `void`, so the
    // rejection became an unhandled promise rejection and the delivery was
    // silently dropped (never nacked, so app-api could not release it promptly).
    await t.start(async () => {
      throw new Error("handler boom");
    });
    fake.handlers.get("channel.delivery.available.v1")?.({
      payload: {
        delivery: {
          id: "dlv_d1",
          leaseToken: "lease_l1",
          adapter: "slack",
          channel: { id: "channel_1", name: "support" },
          turn: {
            id: "turn_t1",
            eventId: "evt_1",
            input: { kind: "text", text: "hi" },
          },
        },
      },
    });

    await vi.waitFor(() =>
      expect(fake.pushes.map((p) => p.event)).toContain(
        "channel.delivery.fail.v1",
      ),
    );
    expect(logs.some((m) => m.includes("turn failed/timed out"))).toBe(true);
    expect(fake.pushes.map((p) => p.event)).not.toContain(
      "channel.delivery.ack.v1",
    );
  });

  it("nacks and logs when the onDelivery handler exceeds deliveryTimeoutMs (per-turn timeout)", async () => {
    const fake = makeFakeSession();
    const logs: string[] = [];
    const t = new RealtimeGatewayTransport({
      ...cfg(fake.session),
      log: (m) => logs.push(m),
      // Tiny per-turn deadline so a hung handler is bounded quickly in the test.
      deliveryTimeoutMs: 10,
    });
    // A handler that never settles — the wedged-turn case the timeout guards.
    await t.start(() => new Promise<void>(() => {}));
    fake.handlers.get("channel.delivery.available.v1")?.({
      payload: {
        delivery: {
          id: "dlv_d1",
          leaseToken: "lease_l1",
          adapter: "slack",
          channel: { id: "channel_1", name: "support" },
          turn: {
            id: "turn_t1",
            eventId: "evt_1",
            input: { kind: "text", text: "hi" },
          },
        },
      },
    });

    await vi.waitFor(
      () =>
        expect(fake.pushes.map((p) => p.event)).toContain(
          "channel.delivery.fail.v1",
        ),
      { timeout: 1000 },
    );
    expect(logs.some((m) => m.includes("turn failed/timed out"))).toBe(true);
  });

  it("drops a delivery with no leaseToken (never fires onDelivery) and logs it", async () => {
    const fake = makeFakeSession();
    const logs: string[] = [];
    const t = new RealtimeGatewayTransport({
      ...cfg(fake.session),
      log: (m) => logs.push(m),
    });
    let delivered = false;
    await t.start(async () => {
      delivered = true;
    });
    fake.handlers.get("channel.delivery.available.v1")?.({
      payload: {
        delivery: {
          id: "dlv_d1",
          // no leaseToken → the SDK can't build a fenced complete/fail intent
          adapter: "slack",
          channel: { id: "channel_1", name: "support" },
          turn: {
            id: "turn_t1",
            eventId: "evt_1",
            input: { kind: "text", text: "hi" },
          },
        },
      },
    });
    await Promise.resolve();

    expect(delivered).toBe(false);
    expect(logs.some((m) => m.includes("no leaseToken"))).toBe(true);
  });

  it("nack with no delivery state sends nothing and logs it", async () => {
    const fake = makeFakeSession();
    const logs: string[] = [];
    const t = new RealtimeGatewayTransport({
      ...cfg(fake.session),
      log: (m) => logs.push(m),
    });
    await t.start(async () => {});

    await t.nack("dlv_unknown", "boom");

    expect(fake.pushes).toHaveLength(0);
    expect(logs.some((m) => m.includes("no delivery state"))).toBe(true);
  });

  it("stamps the delivery's authoritative scope (not the transport default) on render + fail", async () => {
    const fake = makeFakeSession();
    // Transport default scope is org_1 / 7 / channel_1; the delivery carries a
    // DIFFERENT authoritative scope, so this proves DeliveryState.scope is used.
    const t = new RealtimeGatewayTransport(cfg(fake.session));
    await t.start(async () => {});
    fake.handlers.get("channel.delivery.available.v1")?.({
      payload: {
        delivery: {
          id: "dlv_d1",
          leaseToken: "lease_l1",
          organizationId: "org_OTHER",
          projectId: 99,
          adapter: "slack",
          channel: { id: "channel_OTHER", name: "other-channel" },
          turn: {
            id: "turn_t1",
            eventId: "evt_1",
            input: { kind: "text", text: "hi" },
          },
        },
      },
    });
    await Promise.resolve();

    await t.push({
      deliveryId: "dlv_d1",
      turnId: "turn_t1",
      slot: "main",
      seq: 0,
      event: { kind: "run_started" },
    });
    await t.nack("dlv_d1", "boom");

    const inner = (event: string) =>
      (
        fake.pushes.find((p) => p.event === event)!.payload as {
          payload: Record<string, unknown>;
        }
      ).payload;
    for (const p of [
      inner("channel.render_event.v1"),
      inner("channel.delivery.fail.v1"),
    ]) {
      expect(p.organizationId).toBe("org_OTHER");
      expect(p.projectId).toBe(99);
      expect(p.channelId).toBe("channel_OTHER");
      expect(p.channelName).toBe("other-channel");
    }
  });
});
