import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { buildVueSourceContent } from "./vue-source-content";

const showcaseRoot = resolve(import.meta.dirname, "../..");

describe("Vue source content", () => {
  it("indexes the real source for every explicitly supported Vue feature", () => {
    const content = buildVueSourceContent(showcaseRoot);

    expect(Object.keys(content.defaultFileByFeature)).toEqual(["agentic-chat"]);
    expect(
      content.files[content.defaultFileByFeature["agentic-chat"]!]?.content,
    ).toContain("<CopilotChat");
  });
});
