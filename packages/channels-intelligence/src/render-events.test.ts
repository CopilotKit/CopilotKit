import { describe, it, expect, vi } from "vitest";
import type { ReplyTarget } from "@copilotkit/channels-core";
import { intelligenceAdapter } from "./intelligence-adapter.js";
import {
  InMemoryDeliverySource,
  InMemoryEgressSink,
  InMemoryRenderEventSink,
} from "./in-memory-transports.js";
import {
  RealtimeGatewayTransport,
  coerceWireProjectId,
} from "./realtime-gateway-transport.js";
import type { RealtimeGatewaySession } from "./realtime-gateway.js";
import type { ChannelIngressEnvelope } from "./contracts.js";

const targetAttempt = {
  deliveryId: "dlv_d1",
  attemptCount: 1,
  leaseExpiresAt: "2099-07-01T00:02:30.000Z",
};

const target = {
  route: { channel: "C1", threadTs: "100.0" },
  turnId: "turn_t1",
  deliveryId: "dlv_d1",
  deliveryAttempt: targetAttempt,
} as unknown as ReplyTarget;

const validWireAttempt = {
  attempt: 1,
  leaseExpiresAt: "2026-07-01T00:02:30.000Z",
};

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
    expect(
      renderSink.frames.every((f) => f.deliveryAttempt === targetAttempt),
    ).toBe(true);
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

  it("routes a delete through a delete render frame when a renderSink is wired (OSS-420)", async () => {
    const renderSink = new InMemoryRenderEventSink();
    const adapter = intelligenceAdapter({
      source: new InMemoryDeliverySource(),
      egress: new InMemoryEgressSink(),
      renderSink,
    });
    const card = [
      { type: "section", props: { children: "card" } },
    ] as unknown as Parameters<typeof adapter.post>[1];

    const ref = await adapter.post(target, card);
    await adapter.delete(ref);

    const deleteFrame = renderSink.frames.find(
      (f) => f.event.kind === "delete",
    );
    expect(deleteFrame).toBeDefined();
    expect((deleteFrame?.event as { kind: "delete"; ref: string }).ref).toBe(
      ref.id,
    );
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

describe("coerceWireProjectId", () => {
  it("accepts a positive integer number and a numeric string, rejects the rest", () => {
    expect(coerceWireProjectId(7)).toBe(7);
    expect(coerceWireProjectId("9")).toBe(9);
    expect(coerceWireProjectId("007")).toBe(7);
    expect(coerceWireProjectId(0)).toBeUndefined();
    expect(coerceWireProjectId(-1)).toBeUndefined();
    expect(coerceWireProjectId(1.5)).toBeUndefined();
    expect(coerceWireProjectId("0")).toBeUndefined();
    expect(coerceWireProjectId("12.3")).toBeUndefined();
    expect(coerceWireProjectId("abc")).toBeUndefined();
    expect(coerceWireProjectId(undefined)).toBeUndefined();
    expect(coerceWireProjectId(null)).toBeUndefined();
    // Beyond MAX_SAFE_INTEGER: Number("...") is lossy, so reject rather than
    // route under a wrong-but-plausible integer.
    expect(coerceWireProjectId("99999999999999999999")).toBeUndefined();
  });
});

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
          ...validWireAttempt,
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

  it("honors a numeric-string projectId from the wire (per-delivery scope authority)", async () => {
    // The gateway delivery.available payload is untyped JSON, so a projectId can
    // arrive as "9" (string). It must NOT silently fall back to the transport
    // default (7) — that would defeat the per-delivery scope authority and route
    // the render-accept under the wrong project.
    const fake = makeFakeSession();
    const t = new RealtimeGatewayTransport(cfg(fake.session));
    await t.start(async () => {});
    fake.handlers.get("channel.delivery.available.v1")?.({
      payload: {
        delivery: {
          ...validWireAttempt,
          id: "dlv_d1",
          leaseToken: "lease_l1",
          adapter: "slack",
          projectId: "9",
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
    await Promise.resolve();

    await t.push({
      deliveryId: "dlv_d1",
      turnId: "turn_t1",
      slot: "main",
      seq: 0,
      event: { kind: "run_started" },
    });

    const render = fake.pushes.find(
      (p) => p.event === "channel.render_event.v1",
    )!.payload as { payload: { projectId: number } };
    expect(render.payload.projectId).toBe(9);
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
          ...validWireAttempt,
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
          ...validWireAttempt,
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
          ...validWireAttempt,
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

    await vi.waitFor(
      () =>
        expect(fake.pushes.map((p) => p.event)).toContain(
          "channel.delivery.fail.v1",
        ),
      { timeout: 1000 },
    );
    expect(logs.some((m) => m.includes("turn failed/timed out"))).toBe(true);
  });

  it("caps the handler deadline at lease expiry minus the safety margin", async () => {
    const fake = makeFakeSession();
    const t = new RealtimeGatewayTransport({
      ...cfg(fake.session),
      deliveryTimeoutMs: 60_000,
    });
    await t.start(() => new Promise<void>(() => {}));
    fake.handlers.get("channel.delivery.available.v1")?.({
      payload: {
        delivery: {
          attempt: 1,
          leaseExpiresAt: "2026-07-01T00:00:10.010Z",
          id: "dlv_deadline",
          leaseToken: "lease_deadline",
          adapter: "slack",
          channel: { id: "channel_1", name: "support" },
          turn: {
            id: "turn_deadline",
            eventId: "evt_deadline",
            replyTarget: { adapter: "slack", teamId: "T1", channel: "C1" },
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
      { timeout: 1_000 },
    );
  });

  it("fails an UNMAPPABLE (poison) delivery non-retryable instead of dropping it into a re-lease loop", async () => {
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
    // Valid turn id/eventId/leaseToken, but an unmodeled reply-target adapter →
    // mapDeliveryToEnvelope throws. Before the fix this logged + dropped (no
    // fail intent), so app-api re-leased the identical poison payload forever.
    fake.handlers.get("channel.delivery.available.v1")?.({
      payload: {
        delivery: {
          ...validWireAttempt,
          id: "dlv_poison",
          leaseToken: "lease_l1",
          adapter: "slack",
          channel: { id: "channel_1", name: "support" },
          turn: {
            id: "turn_t1",
            eventId: "evt_1",
            replyTarget: { adapter: "discord", guildId: "G1", channel: "C1" },
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
    expect(delivered).toBe(false); // never reached the handler
    const fail = fake.pushes.find(
      (p) => p.event === "channel.delivery.fail.v1",
    )!.payload as {
      payload: { leaseToken?: string; error: { retryable: boolean } };
    };
    // Non-retryable → app-api dead-letters instead of re-leasing.
    expect(fail.payload.error.retryable).toBe(false);
    expect(fail.payload.leaseToken).toBe("lease_l1");
  });

  it("sends exactly one terminal signal per attempt: a late ack after nack no-ops", async () => {
    const fake = makeFakeSession();
    const t = new RealtimeGatewayTransport(cfg(fake.session));
    let delivered = false;
    await t.start(async () => {
      delivered = true;
    });
    fake.handlers.get("channel.delivery.available.v1")?.({
      payload: {
        delivery: {
          ...validWireAttempt,
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
    await vi.waitFor(() => expect(delivered).toBe(true));

    // Simulate the timeout race: the per-turn timeout nacks while the still-
    // running dispatch later acks. The attempt terminal state guarantees the
    // first kind wins and the second no-ops.
    await t.nack("dlv_d1", "timed out", true);
    await t.ack("dlv_d1"); // late ack — state already gone, must send nothing

    const terminals = fake.pushes
      .map((p) => p.event)
      .filter(
        (e) =>
          e === "channel.delivery.fail.v1" ||
          e === "channel.delivery.complete_requested.v1",
      );
    expect(terminals).toEqual(["channel.delivery.fail.v1"]);
  });

  it("preserves terminal state and the first payload across an exact-attempt replay", async () => {
    const fake = makeFakeSession();
    let failPushes = 0;
    const session: RealtimeGatewaySession = {
      on: fake.session.on,
      push: async (event, payload) => {
        const reply = await fake.session.push(event, payload);
        if (event === "channel.delivery.fail.v1" && failPushes++ === 0) {
          throw new Error("response lost after accept");
        }
        return reply;
      },
    };
    let now = "2026-07-01T00:00:00.000Z";
    const logs: string[] = [];
    const attempts: ChannelIngressEnvelope[] = [];
    const t = new RealtimeGatewayTransport({
      ...cfg(session),
      now: () => now,
      log: (message) => logs.push(message),
    });
    await t.start(async (env) => {
      attempts.push(env);
    });
    const available = {
      payload: {
        delivery: {
          ...validWireAttempt,
          id: "dlv_replayed",
          leaseToken: "lease_replayed",
          adapter: "slack",
          channel: { id: "channel_1", name: "support" },
          turn: {
            id: "turn_replayed",
            eventId: "evt_replayed",
            replyTarget: { adapter: "slack", teamId: "T1", channel: "C1" },
            input: { kind: "text", text: "hi" },
          },
        },
      },
    };
    fake.handlers.get("channel.delivery.available.v1")?.(available);
    await vi.waitFor(() => expect(attempts).toHaveLength(1));
    const attempt = attempts[0]!.deliveryAttempt!;

    await expect(t.nack(attempt, "first reason", false)).rejects.toThrow(
      /response lost/,
    );
    // Selecting a terminal intent freezes the attempt's accepted-through
    // boundary immediately. Even though the terminal response was lost and the
    // same payload remains retryable, no later frame may extend that boundary.
    await expect(
      t.push({
        deliveryId: attempt.deliveryId,
        deliveryAttempt: attempt,
        turnId: "turn_replayed",
        slot: "main",
        seq: 0,
        event: { kind: "run_started" },
      }),
    ).rejects.toThrow(/stale delivery attempt/);
    expect(
      fake.pushes.filter((push) => push.event === "channel.render_event.v1"),
    ).toHaveLength(0);

    now = "2026-07-01T00:01:00.000Z";
    fake.handlers.get("channel.delivery.available.v1")?.(available);
    await vi.waitFor(() =>
      expect(
        logs.some((message) => message.includes("duplicate delivery attempt")),
      ).toBe(true),
    );
    expect(attempts).toHaveLength(1);

    await expect(
      t.nack(attempt, "different retry reason", true),
    ).resolves.toBeUndefined();

    const failures = fake.pushes.filter(
      (push) => push.event === "channel.delivery.fail.v1",
    );
    expect(failures).toHaveLength(2);
    expect(JSON.stringify(failures[1]!.payload)).toBe(
      JSON.stringify(failures[0]!.payload),
    );
  });

  it("does not let attempt 1 settle with attempt 2's lease token", async () => {
    const fake = makeFakeSession();
    const logs: string[] = [];
    const t = new RealtimeGatewayTransport({
      ...cfg(fake.session),
      log: (message) => logs.push(message),
    });
    const attempts: ChannelIngressEnvelope[] = [];
    await t.start(async (env) => {
      attempts.push(env);
    });
    const fire = (attempt: number, leaseToken: string) =>
      fake.handlers.get("channel.delivery.available.v1")?.({
        payload: {
          delivery: {
            id: "dlv_same",
            attempt,
            leaseExpiresAt: `2026-07-01T00:0${attempt}:30.000Z`,
            leaseToken,
            adapter: "slack",
            channel: { id: "channel_1", name: "support" },
            turn: {
              id: "turn_same",
              eventId: "evt_same",
              replyTarget: { adapter: "slack", teamId: "T1", channel: "C1" },
              input: { kind: "text", text: "hi" },
            },
          },
        },
      });
    fire(1, "lease_1");
    fire(2, "lease_2");
    await vi.waitFor(() => expect(attempts).toHaveLength(2));

    await t.push({
      deliveryId: "dlv_same",
      deliveryAttempt: attempts[1]!.deliveryAttempt,
      turnId: "turn_same",
      slot: "main",
      seq: 0,
      event: { kind: "run_started" },
    });
    await t.ack(attempts[0]!.deliveryAttempt!);
    await t.ack(attempts[1]!.deliveryAttempt!);

    const terminals = fake.pushes.filter(
      (p) => p.event === "channel.delivery.complete_requested.v1",
    );
    expect(terminals).toHaveLength(1);
    expect(
      (terminals[0]!.payload as { payload: { leaseToken: string } }).payload
        .leaseToken,
    ).toBe("lease_2");
    expect(logs.some((message) => message.includes("stale attempt"))).toBe(
      true,
    );
  });

  it("ignores late older and same-count changed-expiry gateway deliveries", async () => {
    const fake = makeFakeSession();
    const logs: string[] = [];
    const attempts: ChannelIngressEnvelope[] = [];
    const t = new RealtimeGatewayTransport({
      ...cfg(fake.session),
      log: (message) => logs.push(message),
    });
    await t.start(async (env) => {
      attempts.push(env);
    });
    const fire = (
      attempt: number,
      leaseToken: string,
      leaseExpiresAt: string,
    ) =>
      fake.handlers.get("channel.delivery.available.v1")?.({
        payload: {
          delivery: {
            id: "dlv_ordered",
            attempt,
            leaseExpiresAt,
            leaseToken,
            adapter: "slack",
            channel: { id: "channel_1", name: "support" },
            turn: {
              id: "turn_ordered",
              eventId: "evt_ordered",
              replyTarget: { adapter: "slack", teamId: "T1", channel: "C1" },
              input: { kind: "text", text: "hi" },
            },
          },
        },
      });
    fire(2, "lease_2", "2026-07-01T00:02:30.000Z");
    fire(1, "lease_1_late", "2026-07-01T00:01:30.000Z");
    fire(2, "lease_2_changed", "2026-07-01T00:02:00.000Z");

    await vi.waitFor(() => expect(attempts).toHaveLength(1));
    await vi.waitFor(() =>
      expect(
        logs.filter((message) => message.includes("attempt ignored")),
      ).toHaveLength(2),
    );
    const active = attempts[0]!.deliveryAttempt!;
    await t.push({
      deliveryId: active.deliveryId,
      deliveryAttempt: active,
      turnId: "turn_ordered",
      slot: "main",
      seq: 0,
      event: { kind: "run_started" },
    });
    await t.ack(active);

    const terminal = fake.pushes.find(
      (push) => push.event === "channel.delivery.complete_requested.v1",
    )!.payload as { payload: { leaseToken: string } };
    expect(terminal.payload.leaseToken).toBe("lease_2");
  });

  it("rejects invalid attempt identity as a non-retryable poison delivery", async () => {
    const fake = makeFakeSession();
    const t = new RealtimeGatewayTransport(cfg(fake.session));
    let delivered = false;
    await t.start(async () => {
      delivered = true;
    });
    fake.handlers.get("channel.delivery.available.v1")?.({
      payload: {
        delivery: {
          id: "dlv_invalid_attempt",
          attempt: 0,
          leaseExpiresAt: "not-a-date",
          leaseToken: "lease_invalid_attempt",
          adapter: "slack",
          channel: { id: "channel_1", name: "support" },
          turn: {
            id: "turn_invalid_attempt",
            eventId: "evt_invalid_attempt",
            replyTarget: { adapter: "slack", teamId: "T1", channel: "C1" },
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
    expect(delivered).toBe(false);
    const fail = fake.pushes.find(
      (p) => p.event === "channel.delivery.fail.v1",
    )!.payload as { payload: { error: { retryable: boolean } } };
    expect(fail.payload.error.retryable).toBe(false);
  });

  it("processes deliveries serially — a second delivery waits for the first to finish", async () => {
    const fake = makeFakeSession();
    const t = new RealtimeGatewayTransport(cfg(fake.session));
    const order: string[] = [];
    let release1!: () => void;
    const gate1 = new Promise<void>((r) => {
      release1 = r;
    });
    await t.start(async (env) => {
      order.push(`start:${env.deliveryId}`);
      if (env.deliveryId === "d1") await gate1; // first hangs until released
      order.push(`end:${env.deliveryId}`);
    });
    const fire = (id: string) =>
      fake.handlers.get("channel.delivery.available.v1")?.({
        payload: {
          delivery: {
            ...validWireAttempt,
            id,
            leaseToken: "l",
            adapter: "slack",
            channel: { id: "channel_1", name: "support" },
            turn: {
              id: `turn_${id}`,
              eventId: `e_${id}`,
              replyTarget: { adapter: "slack", teamId: "T1", channel: "C1" },
              input: { kind: "text", text: "hi" },
            },
          },
        },
      });
    fire("d1");
    fire("d2");

    await vi.waitFor(() => expect(order).toContain("start:d1"));
    // d2 must NOT have started while d1 is gated (serial, not concurrent).
    expect(order).toEqual(["start:d1"]);
    release1();
    await vi.waitFor(() =>
      expect(order).toEqual(["start:d1", "end:d1", "start:d2", "end:d2"]),
    );
  });

  it("stop() drains the in-flight turn before resolving and ignores deliveries after stop", async () => {
    const fake = makeFakeSession();
    const t = new RealtimeGatewayTransport(cfg(fake.session));
    let started = false;
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    await t.start(async () => {
      calls++;
      started = true;
      await gate; // in-flight turn hangs until released
    });
    const fire = (id: string) =>
      fake.handlers.get("channel.delivery.available.v1")?.({
        payload: {
          delivery: {
            ...validWireAttempt,
            id,
            leaseToken: `lease_${id}`,
            adapter: "slack",
            channel: { id: "channel_1", name: "support" },
            turn: {
              id: `turn_${id}`,
              eventId: `e_${id}`,
              replyTarget: { adapter: "slack", teamId: "T1", channel: "C1" },
              input: { kind: "text", text: "hi" },
            },
          },
        },
      });
    fire("d1");
    await vi.waitFor(() => expect(started).toBe(true));

    // stop() must not resolve until the gated in-flight turn drains.
    let stopResolved = false;
    const stopP = t.stop().then(() => {
      stopResolved = true;
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(stopResolved).toBe(false);
    release();
    await stopP;
    expect(stopResolved).toBe(true);

    // A delivery arriving AFTER stop() is ignored by the guard, never processed.
    fire("d2");
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toBe(1);
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
          ...validWireAttempt,
          id: "dlv_d1",
          // no leaseToken → the SDK can't build a fenced complete/fail intent
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
          ...validWireAttempt,
          id: "dlv_d1",
          leaseToken: "lease_l1",
          organizationId: "org_OTHER",
          projectId: 99,
          adapter: "slack",
          channel: { id: "channel_OTHER", name: "other-channel" },
          turn: {
            id: "turn_t1",
            eventId: "evt_1",
            replyTarget: { adapter: "slack", teamId: "T1", channel: "C1" },
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

  it("maps a non-text turn to its real kind, with actor→user and a thread-stable key (OSS-476)", async () => {
    const fake = makeFakeSession();
    const t = new RealtimeGatewayTransport(cfg(fake.session));
    let env: ChannelIngressEnvelope | undefined;
    await t.start(async (e) => {
      env = e;
    });
    fake.handlers.get("channel.delivery.available.v1")?.({
      payload: {
        delivery: {
          ...validWireAttempt,
          id: "dlv_d1",
          leaseToken: "lease_l1",
          adapter: "slack",
          channel: { id: "channel_1", name: "support" },
          turn: {
            id: "turn_t1",
            eventId: "evt_1",
            replyTarget: {
              adapter: "slack",
              teamId: "T1",
              channel: "C1",
              threadTs: "1700.5",
            },
            actor: { externalUserId: "U42", displayName: "Grace" },
            input: { kind: "command", command: "/deploy", text: "prod" },
          },
        },
      },
    });
    await Promise.resolve();

    expect(env?.kind).toBe("command");
    expect(env).toMatchObject({ command: "/deploy", text: "prod" });
    // Provider identity survived the realtime claim (previously dropped).
    expect(env?.user).toEqual({ id: "U42", displayName: "Grace" });
    // Thread-stable, not the per-turn id it used to be.
    expect(env?.conversationKey).toBe("slack:T1:C1:thread:1700.5");
  });

  it("exposes file/history only when app-api HTTP coordinates are configured (OSS-476)", () => {
    const fake = makeFakeSession();

    const without = new RealtimeGatewayTransport(cfg(fake.session));
    expect(without.fetchFile).toBeUndefined();
    expect(without.getHistory).toBeUndefined();
    expect(without.uploadFile).toBeUndefined();

    const withHttp = new RealtimeGatewayTransport({
      ...cfg(fake.session),
      appApiBaseUrl: "https://app-api.example",
      apiKey: "cpk-test",
    });
    expect(typeof withHttp.fetchFile).toBe("function");
    expect(typeof withHttp.getHistory).toBe("function");
    expect(typeof withHttp.uploadFile).toBe("function");
  });
});
