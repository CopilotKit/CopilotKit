import { describe, it, expect } from "vitest";
import { decodeInteraction, conversationKeyOf } from "./interaction.js";
import { DM_SCOPE } from "./types.js";

describe("conversationKeyOf", () => {
  it("joins channelId + scope with the canonical separator", () => {
    expect(conversationKeyOf({ channelId: "C1", scope: "100.0" })).toBe(
      "C1::100.0",
    );
    expect(conversationKeyOf({ channelId: "D9", scope: DM_SCOPE })).toBe(
      "D9::dm",
    );
  });
});

describe("decodeInteraction", () => {
  it("extracts the opaque action_id + tiny value from a thread block_actions", () => {
    const evt = decodeInteraction({
      type: "block_actions",
      user: { id: "U1", name: "Ana" },
      channel: { id: "C1" },
      message: { ts: "111.1", thread_ts: "100.0" },
      actions: [{ action_id: "ck:abc", value: '{"confirmed":true}' }],
    });
    expect(evt).toBeDefined();
    expect(evt!.id).toBe("ck:abc");
    expect(evt!.value).toEqual({ confirmed: true });
    expect(evt!.conversationKey).toBe("C1::100.0");
    expect(evt!.replyTarget).toEqual({ channel: "C1", threadTs: "100.0" });
    expect(evt!.user).toEqual({ id: "U1", name: "Ana" });
    expect(evt!.messageRef).toEqual({ id: "111.1", channel: "C1" });
  });

  it("uses DM_SCOPE and a flat replyTarget for DM channels", () => {
    const evt = decodeInteraction({
      type: "block_actions",
      user: { id: "U2", username: "bob" },
      channel: { id: "D5" },
      message: { ts: "9.9" },
      actions: [{ action_id: "ck:dm", value: "yes" }],
    });
    expect(evt!.conversationKey).toBe("D5::dm");
    expect(evt!.replyTarget).toEqual({ channel: "D5", threadTs: undefined });
    expect(evt!.value).toBe("yes");
    expect(evt!.user).toEqual({ id: "U2", name: "bob" });
  });

  it("scopes a THREADED DM (assistant pane) by its thread ts, not DM_SCOPE", () => {
    // Regression: an assistant-pane DM is threaded, so the ingress path keys
    // the turn by thread ts. Forcing DM_SCOPE here stranded the HITL waiter and
    // the run never resumed after a Create/Cancel click.
    const evt = decodeInteraction({
      type: "block_actions",
      user: { id: "U3", name: "Cara" },
      channel: { id: "D7" },
      message: { ts: "300.1", thread_ts: "300.0" },
      actions: [{ action_id: "ck:hitl", value: '{"confirmed":true}' }],
    });
    expect(evt!.conversationKey).toBe("D7::300.0");
    // Replies should go back into the assistant thread.
    expect(evt!.replyTarget).toEqual({ channel: "D7", threadTs: "300.0" });
    expect(evt!.value).toEqual({ confirmed: true });
  });

  it("falls back to container fields when message/channel are absent", () => {
    const evt = decodeInteraction({
      type: "block_actions",
      container: { channel_id: "C3", thread_ts: "200.0" },
      actions: [{ action_id: "ck:c", selected_option: { value: "opt-1" } }],
    });
    expect(evt!.conversationKey).toBe("C3::200.0");
    expect(evt!.value).toBe("opt-1");
    expect(evt!.user).toBeUndefined();
  });

  it("decodes a multi_static_select's selected_options into a string[] value", () => {
    const evt = decodeInteraction({
      type: "block_actions",
      container: { channel_id: "C3", thread_ts: "200.0" },
      actions: [
        {
          action_id: "ck:ms",
          selected_options: [{ value: "core" }, { value: "infra" }],
        },
      ],
    });
    expect(evt!.value).toEqual(["core", "infra"]);
  });

  it("returns undefined for non-block_actions or missing action_id", () => {
    expect(decodeInteraction({ type: "view_submission" })).toBeUndefined();
    expect(
      decodeInteraction({ type: "block_actions", actions: [] }),
    ).toBeUndefined();
    expect(
      decodeInteraction({ type: "block_actions", actions: [{ value: "x" }] }),
    ).toBeUndefined();
  });

  it("returns undefined when no channel can be resolved", () => {
    expect(
      decodeInteraction({
        type: "block_actions",
        actions: [{ action_id: "ck:x" }],
      }),
    ).toBeUndefined();
  });

  it("carries a stable eventId from channel + message ts + action_ts (inbound dedup)", () => {
    const payload = {
      type: "block_actions",
      trigger_id: "trig-123",
      channel: { id: "C1" },
      message: { ts: "111.1", thread_ts: "100.0" },
      actions: [
        { action_id: "ck:abc", value: "yes", action_ts: "1700000000.5" },
      ],
    };
    const evt = decodeInteraction(payload);
    expect(evt!.eventId).toBe("C1:111.1:1700000000.5");
    // Stable: decoding the same payload yields the same eventId.
    expect(decodeInteraction(payload)!.eventId).toBe(evt!.eventId);
  });

  it("falls back to trigger_id for eventId when message/action ts are absent", () => {
    const evt = decodeInteraction({
      type: "block_actions",
      trigger_id: "trig-xyz",
      container: { channel_id: "C3" },
      actions: [{ action_id: "ck:c", value: "x" }],
    });
    expect(evt!.eventId).toBe("trig-xyz");
  });

  it("does NOT require a resume field (opaque id only)", () => {
    const evt = decodeInteraction({
      type: "block_actions",
      channel: { id: "C2" },
      message: { ts: "9.9" },
      actions: [{ action_id: "ck:x" }],
    });
    expect(evt!.id).toBe("ck:x");
    // value is undefined when the button carried none — fine; durability rides
    // on the ActionStore, not the payload.
    expect(evt!.value).toBeUndefined();
  });

  it("carries trigger_id from a block_actions payload", () => {
    const evt = decodeInteraction({
      type: "block_actions",
      trigger_id: "T123.456",
      user: { id: "U1" },
      channel: { id: "C1" },
      message: { ts: "1.0" },
      actions: [{ action_id: "ck:x", value: "v" }],
    });
    expect(evt!.triggerId).toBe("T123.456");
  });
});
