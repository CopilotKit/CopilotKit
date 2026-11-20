import { describe, expect, it } from "vitest";
import { isRecipientMentioned } from "./mention.js";

const bot = { id: "28:bot" };

describe("isRecipientMentioned", () => {
  it("is true when a mention entity names the bot", () => {
    expect(
      isRecipientMentioned({
        recipient: bot,
        entities: [
          { type: "clientInfo" },
          { type: "mention", mentioned: { id: "28:bot" } },
        ],
      }),
    ).toBe(true);
  });

  it("is false when only another user is mentioned", () => {
    expect(
      isRecipientMentioned({
        recipient: bot,
        entities: [{ type: "mention", mentioned: { id: "29:someone" } }],
      }),
    ).toBe(false);
  });

  it("is false with no entities or no recipient", () => {
    expect(isRecipientMentioned({ recipient: bot })).toBe(false);
    expect(
      isRecipientMentioned({
        entities: [{ type: "mention", mentioned: { id: "28:bot" } }],
      }),
    ).toBe(false);
  });
});
