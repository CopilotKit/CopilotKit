import React from "react";
import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { StreamingMarkdownDefaultRenderer } from "../StreamingMarkdownDefaultRenderer";

describe("StreamingMarkdownDefaultRenderer", () => {
  it("renders markdown headings", () => {
    render(<StreamingMarkdownDefaultRenderer content="# Hi" />);
    expect(screen.getByText("Hi")).toBeTruthy();
  });

  it("renders bold text", () => {
    const { container } = render(<StreamingMarkdownDefaultRenderer content="**bold**" />);
    expect(container.querySelector("strong")?.textContent).toContain("bold");
  });

  it("renders fenced code with readable theme-aware classes", () => {
    const { container } = render(
      <StreamingMarkdownDefaultRenderer content={"```\ncodeblock\n```"} />,
    );
    const pre = container.querySelector("pre");
    expect(pre).toBeTruthy();
    expect(pre?.className).toContain("cpk:bg-muted");
    expect(pre?.className).toContain("cpk:text-foreground");
    expect(pre?.textContent).toContain("codeblock");
  });

  it("renders nothing for empty content", () => {
    const { container } = render(<StreamingMarkdownDefaultRenderer content="" />);
    expect(container.textContent).toBe("");
  });
});
