import { describe, it, expect } from "vitest";
import { decodeInteraction } from "./interaction.js";

const baseMsg = { id: "m1" };
const channel = { id: "c1", guildId: "g1" };

describe("decodeInteraction", () => {
  it("decodes a button click into an opaque InteractionEvent", () => {
    const evt = decodeInteraction({
      isButton: () => true,
      isStringSelectMenu: () => false,
      customId: "ck:abc123",
      message: baseMsg,
      channelId: "c1",
      guildId: "g1",
      user: { id: "u1", username: "ann", globalName: "Ann" },
    });
    expect(evt).toMatchObject({
      id: "ck:abc123",
      conversationKey: "c1",
      replyTarget: { channelId: "c1", guildId: "g1" },
      user: { id: "u1", name: "Ann", handle: "ann" },
      messageRef: { id: "m1", channelId: "c1" },
    });
  });

  it("unpacks a value-only custom_id (v:<json>)", () => {
    const evt = decodeInteraction({
      isButton: () => true,
      isStringSelectMenu: () => false,
      customId: 'v:{"confirmed":true}',
      message: baseMsg,
      channelId: "c1",
      user: { id: "u1" },
    });
    expect(evt?.value).toEqual({ confirmed: true });
  });

  it("decodes a string-select with its chosen values", () => {
    const evt = decodeInteraction({
      isButton: () => false,
      isStringSelectMenu: () => true,
      customId: "ck:sel1",
      values: ["opt-b"],
      message: baseMsg,
      channelId: "c1",
      user: { id: "u1" },
    });
    expect(evt).toMatchObject({ id: "ck:sel1", value: "opt-b" });
  });

  it("returns undefined for a non-component interaction", () => {
    expect(
      decodeInteraction({ isButton: () => false, isStringSelectMenu: () => false }),
    ).toBeUndefined();
  });
});
