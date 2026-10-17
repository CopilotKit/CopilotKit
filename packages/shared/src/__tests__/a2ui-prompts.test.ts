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
  it("stays compact: visual-style rules live in the catalog descriptions", () => {
    // Markdown mode sends this instead of the tool generation + design pair.
    expect(A2UI_MARKDOWN_GENERATION_GUIDELINES.length).toBeLessThan(3500);
    expect(A2UI_MARKDOWN_GENERATION_GUIDELINES).not.toContain("VISUAL STYLE");
  });
  it("asks for the data model before the components so bound values paint first", () => {
    const g = A2UI_MARKDOWN_GENERATION_GUIDELINES;
    expect(g.indexOf("updateDataModel")).toBeLessThan(
      g.indexOf("updateComponents"),
    );
    expect(g).toContain("then updateDataModel");
  });
});

describe("A2UI_MARKDOWN_GENERATION_GUIDELINES wording", () => {
  it("forbids function calls and the type key, which live models got wrong", () => {
    expect(A2UI_MARKDOWN_GENERATION_GUIDELINES).toContain('{"call": ...}');
    expect(A2UI_MARKDOWN_GENERATION_GUIDELINES).toContain('(never "type")');
  });
  it("keeps Card for interactive panels and prose outside the fence", () => {
    expect(A2UI_MARKDOWN_GENERATION_GUIDELINES).toContain(
      "Use Card only for an interactive panel",
    );
    expect(A2UI_MARKDOWN_GENERATION_GUIDELINES).not.toContain(
      "one bordered Card per section",
    );
    expect(A2UI_MARKDOWN_GENERATION_GUIDELINES).toContain(
      "Never make a surface that is only prose.",
    );
  });
});
