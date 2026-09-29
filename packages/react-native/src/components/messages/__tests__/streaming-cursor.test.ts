import { describe, it, expect } from "vitest";
import { appendStreamingCursor, STREAMING_CURSOR } from "../streaming-cursor";

describe("appendStreamingCursor", () => {
  it("ends a paragraph with the cursor", () => {
    expect(appendStreamingCursor("Hello there")).toBe(
      `Hello there${STREAMING_CURSOR}`,
    );
  });

  it("follows the last block with text, past trailing whitespace", () => {
    expect(appendStreamingCursor("First.\n\nSecond.\n\n")).toBe(
      `First.\n\nSecond.${STREAMING_CURSOR}`,
    );
  });

  it("rides the deepest list item and headings", () => {
    expect(appendStreamingCursor("- one\n  - two")).toBe(
      `- one\n  - two${STREAMING_CURSOR}`,
    );
    expect(appendStreamingCursor("## Title")).toBe(
      `## Title${STREAMING_CURSOR}`,
    );
  });

  it("stays out of an open code block", () => {
    expect(appendStreamingCursor("Code:\n\n```js\nconst a = 1;")).toBe(
      undefined,
    );
  });

  it("stays out of a reply that ends with a closed code block", () => {
    expect(appendStreamingCursor("```\ncode\n```\n")).toBe(undefined);
  });

  it("returns to the text after a closed code block", () => {
    expect(appendStreamingCursor("```\ncode\n```\n\nAfter")).toBe(
      `\`\`\`\ncode\n\`\`\`\n\nAfter${STREAMING_CURSOR}`,
    );
  });

  it("has nothing to follow in empty text", () => {
    expect(appendStreamingCursor("  \n")).toBe(undefined);
  });
});
