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

  it("shows pasted HTML as text, except inside inline code", () => {
    expect(prepareUserMarkdown("<div>hi</div> and `<b>`")).toBe(
      "&lt;div>hi&lt;/div> and `<b>`",
    );
  });

  it("does not touch fenced code", () => {
    const code = "```ts\n# not a heading\nconst a = 1;\n```";
    expect(prepareUserMarkdown(code)).toBe(code);
  });
});
