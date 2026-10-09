import React from "react";
import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
// `react-native` resolves to the shared stub via vitest.config.mjs alias
// (src/react-native/__mocks__/react-native.ts) — no per-file mock needed.
import { StreamingMarkdownRenderer } from "../streaming-markdown-renderer";
describe("RN StreamingMarkdownRenderer", () => {
  it("renders text content", () => {
    const { container } = render(
      <StreamingMarkdownRenderer content="# Title" />,
    );
    expect(container.textContent).toContain("Title");
  });
  it("renders bold text", () => {
    const { container } = render(
      <StreamingMarkdownRenderer content="**bold**" />,
    );
    expect(container.textContent).toContain("bold");
  });
  it("renders code blocks", () => {
    const { container } = render(
      <StreamingMarkdownRenderer content={"```\ncode\n```"} />,
    );
    expect(container.textContent).toContain("code");
  });
  it("renders nothing for empty content", () => {
    const { container } = render(<StreamingMarkdownRenderer content="" />);
    expect(container.textContent).toBe("");
  });
  it("renders inline citations (regression: renderInlineNode dropped them)", () => {
    const { container } = render(
      <StreamingMarkdownRenderer
        content={"Cite [^ref]\n\n[^ref]: Ref https://example.com"}
        isComplete
      />,
    );
    // Before the fix, the inline citation node hit the `default` branch of
    // renderInlineNode and returned null, so the marker silently vanished.
    expect(container.textContent).toContain("Cite");
    expect(container.textContent).toContain("[1]");
  });
  it("does NOT crash when Intl.Segmenter is unavailable, even with animate", () => {
    // Simulate Hermes (the default RN engine), which may not ship Intl.Segmenter.
    // `animate` is the only path that touches the segmenter, so it must be on
    // for this test to actually exercise the unavailable-Segmenter branch.
    const intl = (globalThis as any).Intl;
    const original = intl?.Segmenter;
    try {
      if (intl) delete intl.Segmenter;
      const { container } = render(
        <StreamingMarkdownRenderer
          content="streaming text"
          isComplete={false}
          animate
        />,
      );
      expect(container.textContent).toContain("streaming text");
    } finally {
      if (intl && original) intl.Segmenter = original;
    }
  });
});
