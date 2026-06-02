import React from "react";
import { render } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
vi.mock("react-native", () => ({
  StyleSheet: { create: (s: any) => s, flatten: (s: any) => s },
  View: "View", Text: "Text",
}));
import { StreamingMarkdownRenderer } from "../streaming-markdown-renderer";
describe("RN StreamingMarkdownRenderer", () => {
  it("renders text content", () => {
    const { container } = render(<StreamingMarkdownRenderer content="# Title" />);
    expect(container.textContent).toContain("Title");
  });
  it("renders bold text", () => {
    const { container } = render(<StreamingMarkdownRenderer content="**bold**" />);
    expect(container.textContent).toContain("bold");
  });
  it("renders code blocks", () => {
    const { container } = render(<StreamingMarkdownRenderer content={"```\ncode\n```"} />);
    expect(container.textContent).toContain("code");
  });
  it("renders nothing for empty content", () => {
    const { container } = render(<StreamingMarkdownRenderer content="" />);
    expect(container.textContent).toBe("");
  });
  it("does NOT crash when Intl.Segmenter is unavailable (default segmenter:false)", () => {
    const { container } = render(<StreamingMarkdownRenderer content="streaming text" isComplete={false} />);
    expect(container.textContent).toContain("streaming text");
  });
});
