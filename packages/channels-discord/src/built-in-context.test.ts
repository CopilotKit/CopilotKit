import { describe, it, expect } from "vitest";
import {
  discordFormattingContext,
  discordConversationModelContext,
  discordTaggingContext,
  defaultDiscordContext,
} from "./built-in-context.js";

describe("defaultDiscordContext", () => {
  it("bundles the three context entries", () => {
    expect(defaultDiscordContext).toEqual([
      discordTaggingContext,
      discordFormattingContext,
      discordConversationModelContext,
    ]);
  });
  it("each entry has a description and value", () => {
    for (const e of defaultDiscordContext) {
      expect(typeof e.description).toBe("string");
      expect(e.value.length).toBeGreaterThan(0);
    }
  });
  it("formatting guidance warns there are no tables and gives mention syntax", () => {
    expect(discordFormattingContext.value).toMatch(/table/i);
    expect(discordFormattingContext.value).toContain("<@");
  });
});
