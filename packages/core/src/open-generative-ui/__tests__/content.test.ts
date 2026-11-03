import { describe, expect, it } from "vitest";
import { hasRenderableContent, shouldFlushImmediately } from "../content";
import type { OpenGenerativeUIContent } from "../content";

const streaming: OpenGenerativeUIContent = {
  cssComplete: true,
  html: ["<body><p>One"],
  generating: true,
};

describe("hasRenderableContent", () => {
  it("is true for complete HTML and for styled streaming HTML", () => {
    expect(
      hasRenderableContent({ html: ["<p>Hi</p>"], htmlComplete: true }),
    ).toBe(true);
    expect(hasRenderableContent(streaming)).toBe(true);
  });

  it("is false for streaming HTML before CSS completes, blank HTML, or no content", () => {
    expect(hasRenderableContent({ html: ["<p>Hi"] })).toBe(false);
    expect(hasRenderableContent({ html: ["  "], htmlComplete: true })).toBe(
      false,
    );
    expect(hasRenderableContent(undefined)).toBe(false);
  });
});

describe("shouldFlushImmediately", () => {
  it("waits for the throttle while only more HTML streams in", () => {
    expect(
      shouldFlushImmediately(streaming, {
        ...streaming,
        html: ["<body><p>One", "</p><p>Two"],
      }),
    ).toBe(false);
  });

  it("waits for the throttle while CSS streams in", () => {
    expect(shouldFlushImmediately({ css: "a{" }, { css: "a{color:red" })).toBe(
      false,
    );
  });

  it.each<[string, OpenGenerativeUIContent, OpenGenerativeUIContent]>([
    ["CSS completes", { css: "a{}" }, { css: "a{}", cssComplete: true }],
    ["HTML completes", streaming, { ...streaming, htmlComplete: true }],
    ["generation finishes", streaming, { ...streaming, generating: false }],
    [
      "jsFunctions appear",
      streaming,
      { ...streaming, jsFunctions: "function f() {}" },
    ],
    [
      "jsExpressions grow",
      { ...streaming, jsExpressions: ["a()"] },
      { ...streaming, jsExpressions: ["a()", "b()"] },
    ],
    [
      "the first HTML chunk arrives",
      { css: "a{}" },
      { css: "a{}", html: ["<p"] },
    ],
    [
      "a new generation replaces rendered content",
      { html: ["<p>Old</p>"], htmlComplete: true },
      { generating: true, htmlComplete: false },
    ],
  ])("flushes at once when %s", (_name, previous, next) => {
    expect(shouldFlushImmediately(previous, next)).toBe(true);
  });
});
