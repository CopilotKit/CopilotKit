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

  it("splits a combined handler+value custom_id (ck:<id>;v:<json>)", () => {
    // A button with BOTH an onClick and a value (the HITL confirm gate). The
    // bare id must still dispatch the onClick, AND the value must reach the
    // awaitChoice waiter — otherwise an approval is read as "declined".
    const evt = decodeInteraction({
      isButton: () => true,
      isStringSelectMenu: () => false,
      customId: 'ck:abc123;v:{"confirmed":true}',
      message: baseMsg,
      channelId: "c1",
      user: { id: "u1" },
    });
    expect(evt?.id).toBe("ck:abc123");
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

  it("JSON-parses a string-select value that round-trips (object)", () => {
    const evt = decodeInteraction({
      isButton: () => false,
      isStringSelectMenu: () => true,
      customId: "ck:sel2",
      values: ['{"k":1}'],
      message: baseMsg,
      channelId: "c1",
      user: { id: "u1" },
    });
    expect(evt?.value).toEqual({ k: 1 });
  });

  it("JSON-parses a string-select value that round-trips (number)", () => {
    const evt = decodeInteraction({
      isButton: () => false,
      isStringSelectMenu: () => true,
      customId: "ck:sel3",
      values: ["42"],
      message: baseMsg,
      channelId: "c1",
      user: { id: "u1" },
    });
    expect(evt?.value).toBe(42);
  });

  it("keeps a plain non-JSON string-select value as the raw string", () => {
    const evt = decodeInteraction({
      isButton: () => false,
      isStringSelectMenu: () => true,
      customId: "ck:sel4",
      values: ["opt-a"],
      message: baseMsg,
      channelId: "c1",
      user: { id: "u1" },
    });
    expect(evt?.value).toBe("opt-a");
  });

  it("decodes a multi-select (maxValues > 1) into a string[] of chosen values", () => {
    const evt = decodeInteraction({
      isButton: () => false,
      isStringSelectMenu: () => true,
      customId: "ck:ms",
      component: { maxValues: 5 },
      values: ["core", "infra"],
      message: baseMsg,
      channelId: "c1",
      user: { id: "u1" },
    });
    expect(evt?.value).toEqual(["core", "infra"]);
  });

  it("returns undefined for a non-component interaction", () => {
    expect(
      decodeInteraction({
        isButton: () => false,
        isStringSelectMenu: () => false,
      }),
    ).toBeUndefined();
  });

  it("returns undefined (not throws) when isStringSelectMenu is absent", () => {
    expect(decodeInteraction({ isButton: () => false })).toBeUndefined();
  });
});
