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
  it("is shorter than the tool guideline", () => {
    expect(A2UI_MARKDOWN_GENERATION_GUIDELINES.length).toBeLessThan(
      A2UI_DEFAULT_GENERATION_GUIDELINES.length,
    );
  });
});
