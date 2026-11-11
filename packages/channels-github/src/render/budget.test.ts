import { describe, expect, it } from "vitest";
import { withBotMarker } from "../bot-marker.js";
import {
  GITHUB_API_COMMENT_BODY_MAX,
  GITHUB_LIMITS,
  truncateText,
} from "./budget.js";

describe("truncateText", () => {
  it("returns text within the budget unchanged", () => {
    expect(truncateText("hello", 5)).toBe("hello");
  });

  it("cuts long text to the budget and ends it with the visible marker", () => {
    const out = truncateText("a".repeat(100), 30);
    expect(out).toBe(`${"a".repeat(13)}\n\n… _(truncated)_`);
    expect(out).toHaveLength(30);
  });

  it("hard-cuts when the budget is smaller than the marker", () => {
    expect(truncateText("abcdefghij", 4)).toBe("abcd");
  });

  it("fits a GitHub comment body, with the bot marker added", () => {
    const body = truncateText("z".repeat(70000), GITHUB_LIMITS.commentBody);
    expect(withBotMarker(body)).toHaveLength(GITHUB_API_COMMENT_BODY_MAX);
  });
});
