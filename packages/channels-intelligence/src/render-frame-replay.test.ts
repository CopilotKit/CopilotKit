import { describe, it, expect } from "vitest";
import type { ReplyTarget } from "@copilotkit/channels-core";
import { intelligenceAdapter } from "./intelligence-adapter.js";
import {
  InMemoryDeliverySource,
  InMemoryEgressSink,
} from "./in-memory-transports.js";
import type { RenderFrame } from "./contracts.js";
import type { RenderEventSink } from "./transports.js";

/**
 * Replay stability of render frames (OSS-648).
 *
 * A turn's id is a pure function of its delivery id (`turn_<deliveryId>`, which
 * app-api enforces), and the adapter resets the per-turn seq counter for each
 * dispatch. So a redelivery — lease expiry, runtime crash mid-turn, gateway
 * disconnect — replays the SAME turn into the SAME seq space.
 *
 * app-api treats that space as an idempotency key: re-pushing `(turn, slot, seq)`
 * with a byte-identical payload is `duplicate_accepted`, but re-pushing it with a
 * DIFFERENT payload is `CHANNEL_RENDER_FRAME_CONFLICT` — a hard error that nacks
 * the delivery. So every frame the SDK pushes at a given seq must carry the same
 * payload on every attempt.
 *
 * This holds while frames stay 1:1 with AG-UI events, because seq k always
 * carries delta k no matter how the pushes are grouped or timed. It is a guard
 * on any future change to the send path: batching the TRANSPORT (many frames per
 * request) keeps it, whereas merging frame CONTENT breaks it, since merge
 * boundaries depend on wall-clock arrival and a replay cuts them differently.
 */

const target = {
  route: { channel: "C1", threadTs: "100.0" },
  turnId: "turn_dlv_replay",
  deliveryId: "dlv_replay",
} as unknown as ReplyTarget;

type Sub = Record<string, (p: { event: Record<string, unknown> }) => unknown>;

/** Stable stringify mirroring app-api's payload comparison. */
const stable = (v: unknown): string =>
  JSON.stringify(v, (_k, val) =>
    val && typeof val === "object" && !Array.isArray(val)
      ? Object.fromEntries(
          Object.entries(val).sort(([a], [b]) => (a < b ? -1 : 1)),
        )
      : val,
  );

/**
 * Render sink enforcing app-api's real same-seq contract, with rows surviving
 * across attempts the way `cpki.channel_render_acceptances` does.
 */
class PlatformLikeSink implements RenderEventSink {
  constructor(
    private readonly rows: Map<string, string>,
    private readonly gate?: { promise: Promise<void>; pushes: number },
  ) {}

  async push(frame: RenderFrame) {
    // Optionally block the FIRST push so later frames pile up behind it, which
    // is what makes the coalescer merge them.
    if (this.gate) {
      this.gate.pushes += 1;
      if (this.gate.pushes === 1) await this.gate.promise;
    }
    const key = `${frame.turnId}:${frame.slot}:${frame.seq}`;
    const payload = stable(frame.event);
    const existing = this.rows.get(key);
    if (existing !== undefined && existing !== payload) {
      throw new Error(
        `CHANNEL_RENDER_FRAME_CONFLICT at ${key}: stored ${existing} but pushed ${payload}`,
      );
    }
    this.rows.set(key, payload);
    return { idempotencyKey: key, acceptance: "accepted" as const };
  }
}

/** Let the push pump finish whatever it is holding. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0));
};

const DELTAS = ["a", "b", "c", "d"];

describe("render frame replay stability (OSS-648)", () => {
  it("does not reuse a seq with a different payload when a turn is redelivered", async () => {
    // Durable rows outlive both attempts, like the platform table.
    const rows = new Map<string, string>();

    // ATTEMPT 1 — slow first push, so all four deltas arrive while it is in
    // flight and coalesce into a single frame.
    const release = { resolve: (): void => {}, pushes: 0 };
    const gate = {
      promise: new Promise<void>((r) => {
        release.resolve = r;
      }),
      pushes: 0,
    };
    const slow = intelligenceAdapter({
      source: new InMemoryDeliverySource(),
      egress: new InMemoryEgressSink(),
      renderSink: new PlatformLikeSink(rows, gate),
    });
    const first = slow.createRunRenderer(target);
    const firstSub = first.subscriber as unknown as Sub;
    for (const delta of DELTAS) {
      firstSub.onTextMessageContentEvent?.({
        event: { messageId: "m1", delta },
      });
    }
    release.resolve();
    await first.finish?.();

    // ATTEMPT 2 — the same delivery redelivered to a fresh runtime instance, so
    // the seq counter restarts at 0 exactly as `dispatch()` resets it. This time
    // each delta is pushed on its own, so the merge boundaries differ.
    const fast = intelligenceAdapter({
      source: new InMemoryDeliverySource(),
      egress: new InMemoryEgressSink(),
      renderSink: new PlatformLikeSink(rows),
    });
    const second = fast.createRunRenderer(target);
    const secondSub = second.subscriber as unknown as Sub;
    for (const delta of DELTAS) {
      secondSub.onTextMessageContentEvent?.({
        event: { messageId: "m1", delta },
      });
      await settle();
    }

    // The replay must not collide with attempt 1's rows. Today the last delta
    // lands on the seq that attempt 1 used for the merged frame, so the platform
    // rejects it and the delivery nacks.
    await expect(second.finish?.()).resolves.toBeUndefined();
  });
});
