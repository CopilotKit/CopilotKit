import { describe, it, expect } from "vitest";
import {
  defaultGoogleChatContext,
  googleChatTaggingContext,
  googleChatFormattingContext,
  googleChatConversationModelContext,
} from "./built-in-context.js";

describe("defaultGoogleChatContext", () => {
  it("has exactly 3 entries", () => {
    expect(defaultGoogleChatContext).toHaveLength(3);
  });

  it("every entry has a non-empty description string", () => {
    for (const entry of defaultGoogleChatContext) {
      expect(typeof entry.description).toBe("string");
      expect(entry.description.length).toBeGreaterThan(0);
    }
  });

  it("every entry has a non-empty value string", () => {
    for (const entry of defaultGoogleChatContext) {
      expect(typeof entry.value).toBe("string");
      expect((entry.value as string).length).toBeGreaterThan(0);
    }
  });

  it("contains the tagging, formatting, and conversation model entries", () => {
    expect(defaultGoogleChatContext[0]).toBe(googleChatTaggingContext);
    expect(defaultGoogleChatContext[1]).toBe(googleChatFormattingContext);
    expect(defaultGoogleChatContext[2]).toBe(googleChatConversationModelContext);
  });
});
