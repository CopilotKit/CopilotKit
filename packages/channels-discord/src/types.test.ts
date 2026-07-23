import { describe, it, expect } from "vitest";
import { conversationKeyOf } from "./types.js";
import type { ReplyTarget } from "./types.js";

describe("conversationKeyOf", () => {
  it("uses the channel id as the conversation key", () => {
    const t: ReplyTarget = { channelId: "123", guildId: "g1" };
    expect(conversationKeyOf(t)).toBe("123");
  });
  it("works for DMs with no guild", () => {
    const t: ReplyTarget = { channelId: "dm-999" };
    expect(conversationKeyOf(t)).toBe("dm-999");
  });
});
