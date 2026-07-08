// packages/channels-telegram/src/__tests__/reactions.test.ts
import { describe, it, expect, vi } from "vitest";
import { decodeReaction } from "../interaction.js";

it("emits an added event for a newly added emoji", () => {
  const evts = decodeReaction({
    message_reaction: {
      chat: { id: 42, type: "private" },
      message_id: 7,
      user: { id: 1, username: "ada" },
      old_reaction: [],
      new_reaction: [{ type: "emoji", emoji: "👍" }],
    },
  });
  expect(evts).toHaveLength(1);
  expect(evts[0]).toMatchObject({
    rawEmoji: "👍",
    added: true,
    messageId: "7",
    user: { id: "1", handle: "ada" },
  });
});

it("emits a removed event when an emoji disappears", () => {
  const evts = decodeReaction({
    message_reaction: {
      chat: { id: 42, type: "private" },
      message_id: 7,
      user: { id: 1 },
      old_reaction: [{ type: "emoji", emoji: "🔥" }],
      new_reaction: [],
    },
  });
  expect(evts[0]).toMatchObject({ rawEmoji: "🔥", added: false });
});

it("ignores custom_emoji reactions (no unicode token)", () => {
  const evts = decodeReaction({
    message_reaction: {
      chat: { id: 1, type: "private" },
      message_id: 1,
      user: { id: 1 },
      old_reaction: [],
      new_reaction: [{ type: "custom_emoji", custom_emoji_id: "x" }],
    },
  });
  expect(evts).toEqual([]);
});
