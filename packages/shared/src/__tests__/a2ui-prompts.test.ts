import { describe, expect, it } from "vitest";
import {
  A2UI_MARKDOWN_GENERATION_GUIDELINES,
  A2UI_DEFAULT_GENERATION_GUIDELINES,
} from "../a2ui-prompts";

describe("A2UI_MARKDOWN_GENERATION_GUIDELINES", () => {
  it("instructs the model to use a2ui fences and never the tool", () => {
    expect(A2UI_MARKDOWN_GENERATION_GUIDELINES).toContain("```a2ui");
    expect(A2UI_MARKDOWN_GENERATION_GUIDELINES).toContain(
      "one JSON object per line",
    );
    expect(A2UI_MARKDOWN_GENERATION_GUIDELINES).not.toContain("render_a2ui");
    expect(A2UI_MARKDOWN_GENERATION_GUIDELINES).toContain('"root"');
  });
  it("stays compact even though it carries its own visual-style rules", () => {
    // Markdown mode sends this instead of the tool generation + design pair.
    expect(A2UI_MARKDOWN_GENERATION_GUIDELINES.length).toBeLessThan(6000);
    expect(A2UI_MARKDOWN_GENERATION_GUIDELINES).toContain("VISUAL STYLE");
  });
});

describe("A2UI_MARKDOWN_GENERATION_GUIDELINES wording", () => {
  it("forbids function calls and the type key, which live models got wrong", () => {
    expect(A2UI_MARKDOWN_GENERATION_GUIDELINES).toContain('{"call": ...}');
    expect(A2UI_MARKDOWN_GENERATION_GUIDELINES).toContain('(never "type")');
  });
});
