import { describe, expect, it } from "vitest";
import type { IngressSink } from "@copilotkit/channels-core";
import { intelligenceAdapter } from "./intelligence-adapter.js";
import {
  InMemoryDeliverySource,
  InMemoryEgressSink,
  InMemoryRenderEventSink,
} from "./in-memory-transports.js";
import { renderLaneSlot, RENDER_LANE_BASE_SLOT } from "./render-batches.js";
import type { ChannelIngressEnvelope } from "./contracts.js";

/** The platform's `channelRenderSlotSchema` charset (1–64 of these). */
const PLATFORM_SLOT_RE = /^[A-Za-z0-9_-]{1,64}$/;

const turnEnvelope = (deliveryId: string): ChannelIngressEnvelope =>
  ({
    kind: "turn",
    conversationKey: "C1:100.0",
    route: { channel: "C1", threadTs: "100.0" },
    turnId: `turn_${deliveryId}`,
    deliveryId,
    eventId: `evt_${deliveryId}`,
    platform: "slack",
    text: "hi",
  }) as unknown as ChannelIngressEnvelope;

/**
 * Start an adapter whose inbound turn handler posts one message, so a `deliver`
 * exercises the real dispatch path (lane resolution → render frame → ref).
 */
const startPostingAdapter = async (
  source: InMemoryDeliverySource,
  renderSink: InMemoryRenderEventSink,
) => {
  const adapter = intelligenceAdapter({
    source,
    egress: new InMemoryEgressSink(),
    renderSink,
  });
  const refs: string[] = [];
  const sink = {
    onTurn: async (turn: { replyTarget: unknown }) => {
      const ref = await adapter.post(turn.replyTarget as never, [
        { type: "text", props: { value: "reply" } },
      ]);
      refs.push(ref.id);
    },
  } as unknown as IngressSink;
  await adapter.start(sink, { channelName: "support" });
  return { refs };
};

describe("renderLaneSlot", () => {
  it("falls back to the base lane when the source does not lease", () => {
    expect(renderLaneSlot(undefined)).toBe(RENDER_LANE_BASE_SLOT);
    expect(renderLaneSlot("")).toBe(RENDER_LANE_BASE_SLOT);
  });

  it("derives a platform-legal lane from a lease token", () => {
    const slot = renderLaneSlot("lease_abc123");
    expect(slot).toMatch(PLATFORM_SLOT_RE);
    expect(slot.startsWith(`${RENDER_LANE_BASE_SLOT}-`)).toBe(true);
    // Keeps `turnId:slot:seq` inside the platform's 260-char frame-key bound.
    expect(slot.length).toBeLessThanOrEqual(64);
  });

  it("is stable for one token and distinct across attempts", () => {
    expect(renderLaneSlot("lease_attempt_1")).toBe(
      renderLaneSlot("lease_attempt_1"),
    );
    expect(renderLaneSlot("lease_attempt_1")).not.toBe(
      renderLaneSlot("lease_attempt_2"),
    );
  });

  it("does not embed the raw lease token", () => {
    // The slot is persisted per acceptance and is operator-readable, while the
    // token is the capability the platform fences accept/ack/fail against.
    const token = "lease_supersecretcapability";
    expect(renderLaneSlot(token)).not.toContain("supersecretcapability");
  });
});

describe("per-attempt render lane", () => {
  it("streams a redelivery into its own lane", async () => {
    const source = new InMemoryDeliverySource();
    const renderSink = new InMemoryRenderEventSink();
    await startPostingAdapter(source, renderSink);

    source.leaseTokens.set("dlv_1", "lease_attempt_one");
    await source.deliver(turnEnvelope("dlv_1"));
    // Redelivery: same delivery + turn id, fresh lease token.
    source.leaseTokens.set("dlv_1", "lease_attempt_two");
    await source.deliver(turnEnvelope("dlv_1"));

    const slots = [...new Set(renderSink.batches.map((b) => b.slot))];
    expect(slots).toHaveLength(2);
    expect(slots[0]).not.toBe(slots[1]);
    // Both attempts restart the sequence, which is only safe because each lane
    // carries its own accepted high-water on the platform side.
    expect(renderSink.batches[0]!.startSeq).toBe(0);
    expect(renderSink.batches.find((b) => b.slot === slots[1])!.startSeq).toBe(
      0,
    );
  });

  it("mints message refs under the same lane the frame was pushed to", async () => {
    const source = new InMemoryDeliverySource();
    const renderSink = new InMemoryRenderEventSink();
    const { refs } = await startPostingAdapter(source, renderSink);

    source.leaseTokens.set("dlv_2", "lease_attempt_one");
    await source.deliver(turnEnvelope("dlv_2"));

    const posted = renderSink.frames.find((f) => f.event.kind === "post")!;
    // The Connector Outbox resolves refs as `turnId:slot:seq`; a ref on a
    // different lane than its frame would never resolve.
    expect(refs[0]).toBe(`${posted.turnId}:${posted.slot}:${posted.seq}`);
    expect(posted.slot).toBe(renderLaneSlot("lease_attempt_one"));
  });

  it("keeps the base lane when the source has no lease token", async () => {
    const source = new InMemoryDeliverySource();
    const renderSink = new InMemoryRenderEventSink();
    const { refs } = await startPostingAdapter(source, renderSink);

    await source.deliver(turnEnvelope("dlv_3"));

    expect(
      renderSink.batches.every((b) => b.slot === RENDER_LANE_BASE_SLOT),
    ).toBe(true);
    expect(refs[0]).toBe(`turn_dlv_3:${RENDER_LANE_BASE_SLOT}:0`);
  });
});
