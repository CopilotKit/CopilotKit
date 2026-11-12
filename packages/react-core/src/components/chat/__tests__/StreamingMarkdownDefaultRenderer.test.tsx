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
    const { container } = render(
      <StreamingMarkdownDefaultRenderer content="**bold**" />,
    );
    expect(container.querySelector("strong")?.textContent).toContain("bold");
  });

  it("renders fenced code with readable theme-aware classes", () => {
    const { container } = render(
      <StreamingMarkdownDefaultRenderer content={"```\ncodeblock\n```"} />,
    );
    const pre = container.querySelector("pre");
    expect(pre).toBeTruthy();
    expect(pre).toHaveClass("cpk-markdown-code-block");
    expect(pre?.textContent).toContain("codeblock");
  });

  it("keeps the code fence language and shows the caret in a streaming code block", () => {
    const { container } = render(
      <StreamingMarkdownDefaultRenderer
        content={"```ts\nconst a"}
        isStreaming
      />,
    );
    const pre = container.querySelector("pre.cpk-markdown-code-block");
    expect(pre?.querySelector("code")?.getAttribute("data-code-info")).toBe(
      "ts",
    );
    expect(
      pre?.querySelector("code [data-streaming-markdown-caret]"),
    ).not.toBeNull();
  });

  it("renders nothing for empty content", () => {
    const { container } = render(
      <StreamingMarkdownDefaultRenderer content="" />,
    );
    expect(container.textContent).toBe("");
  });
});
