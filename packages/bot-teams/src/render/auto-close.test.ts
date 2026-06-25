import { describe, it, expect } from "vitest";
import { autoCloseOpenMarkdown as ac } from "./auto-close.js";

describe("autoCloseOpenMarkdown", () => {
  it("leaves empty and already-balanced text untouched (no synthetic closers)", () => {
    expect(ac("")).toBe("");
    expect(ac("plain text")).toBe("plain text");
    expect(ac("**bold** and _italic_")).toBe("**bold** and _italic_");
    expect(ac("```js\nconst x = 1;\n```")).toBe("```js\nconst x = 1;\n```");
  });

  it("closes an unclosed bold/italic/strike that has content", () => {
    expect(ac("**bold")).toBe("**bold**");
    expect(ac("_italic")).toBe("_italic_");
    expect(ac("~~strike")).toBe("~~strike~~");
  });

  it("closes nested markers innermost-first", () => {
    expect(ac("**bold _italic")).toBe("**bold _italic_**");
  });

  it("inserts closers before trailing whitespace", () => {
    expect(ac("**bold ")).toBe("**bold** ");
  });

  it("does NOT close a marker with no content after it (avoids transient ****)", () => {
    expect(ac("hello **")).toBe("hello **");
    expect(ac("text _")).toBe("text _");
  });

  it("closes an open inline code span with content, but not a bare opener", () => {
    expect(ac("run `npm test")).toBe("run `npm test`");
    expect(ac("a paired `span` then more")).toBe("a paired `span` then more");
  });

  it("closes an open fence only once there's code past the language line", () => {
    expect(ac("```js")).toBe("```js"); // still on the language line
    expect(ac("```js\n")).toBe("```js\n"); // language line, no code yet
    expect(ac("```js\nconst x = 1;")).toBe("```js\nconst x = 1;\n```");
    expect(ac("```\nplain code")).toBe("```\nplain code\n```");
  });

  it("does not corrupt digits adjacent to balanced regions (sentinel safety)", () => {
    // Regression guard: the placeholder sentinels must be real PUA codepoints,
    // not empty strings, otherwise the restore regex would eat bare digits.
    expect(ac("```\ncode\n```\n12345 items")).toBe(
      "```\ncode\n```\n12345 items",
    );
    expect(ac("see `x` then 2024 and 99")).toBe("see `x` then 2024 and 99");
  });

  it("is idempotent once the real closer arrives", () => {
    // mid-stream we'd have closed it; the finalized balanced text adds nothing.
    expect(ac("**done**")).toBe("**done**");
    expect(ac(ac("**partial"))).toBe(ac("**partial"));
  });
});
