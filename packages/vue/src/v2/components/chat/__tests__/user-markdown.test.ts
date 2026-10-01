import { describe, expect, it } from "vitest";
import { prepareUserMarkdown } from "../user-markdown";

describe("prepareUserMarkdown", () => {
  it("keeps single line breaks as typed", () => {
    expect(prepareUserMarkdown("first\nsecond")).toBe("first  \nsecond");
  });

  it("leaves paragraph breaks alone", () => {
    expect(prepareUserMarkdown("first\n\nsecond")).toBe("first\n\nsecond");
  });

  it("keeps # lines literal instead of headings", () => {
    expect(prepareUserMarkdown("# Title")).toBe("\\# Title");
    expect(prepareUserMarkdown("### Notes\nbody")).toBe("\\### Notes  \nbody");
  });

  it("leaves HTML to the markdown parser", () => {
    // remarkHtmlAsText shows it as text once code spans are known.
    expect(prepareUserMarkdown("<div>hi</div> and `<b>`")).toBe(
      "<div>hi</div> and `<b>`",
    );
  });

  it("does not touch fenced code", () => {
    const code = "```ts\n# not a heading\nconst a = 1;\n```";
    expect(prepareUserMarkdown(code)).toBe(code);
  });

  it("closes a fence only with the same character, at least as long", () => {
    const code = "````md\n```\n# inside\n````\n# after";
    expect(prepareUserMarkdown(code)).toBe(
      "````md\n```\n# inside\n````\n\\# after",
    );
  });
});
