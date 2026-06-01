import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import "@testing-library/jest-dom";
import { BasicMarkdownRenderer } from "../BasicMarkdownRenderer";

describe("BasicMarkdownRenderer", () => {
  it("renders headings", () => {
    render(<BasicMarkdownRenderer content="# Title" />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Title");
  });

  it("renders bold and italic", () => {
    const { container } = render(
      <BasicMarkdownRenderer content="**b** and *i*" />,
    );
    expect(container.querySelector("strong")?.textContent).toBe("b");
    expect(container.querySelector("em")?.textContent).toBe("i");
  });

  it("renders links with href", () => {
    render(<BasicMarkdownRenderer content="[CK](https://copilotkit.ai)" />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "https://copilotkit.ai");
  });

  it("renders fenced code blocks", () => {
    const { container } = render(
      <BasicMarkdownRenderer content={"```\ncode here\n```"} />,
    );
    expect(container.querySelector("pre code")?.textContent).toContain(
      "code here",
    );
  });

  it("renders unordered lists", () => {
    const { container } = render(
      <BasicMarkdownRenderer content={"- one\n- two"} />,
    );
    expect(container.querySelectorAll("li")).toHaveLength(2);
  });

  it("renders GFM tables", () => {
    const md = "| a | b |\n| --- | --- |\n| 1 | 2 |";
    const { container } = render(<BasicMarkdownRenderer content={md} />);
    expect(container.querySelector("table")).toBeTruthy();
    expect(container.querySelectorAll("th")).toHaveLength(2);
    expect(container.querySelectorAll("tbody td")).toHaveLength(2);
  });

  it("escapes raw HTML (no injection)", () => {
    const { container } = render(
      <BasicMarkdownRenderer content={"<img src=x onerror=alert(1)>"} />,
    );
    expect(container.querySelector("img")).toBeNull();
  });

  it("renders nothing for empty content", () => {
    const { container } = render(<BasicMarkdownRenderer content="" />);
    expect(container.textContent).toBe("");
  });

  it("neutralizes javascript: URIs in links (no XSS)", () => {
    const { container } = render(
      <BasicMarkdownRenderer content="[click](javascript:alert(1))" />,
    );
    // An <a> without href loses ARIA role="link"; query by tag instead.
    const anchor = container.querySelector("a");
    expect(anchor).toBeTruthy();
    expect(anchor?.getAttribute("href")).toBeNull();
  });

  it("keeps safe link schemes", () => {
    render(<BasicMarkdownRenderer content="[m](mailto:a@b.com)" />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "mailto:a@b.com");
  });

  it("neutralizes javascript: image src", () => {
    const { container } = render(
      <BasicMarkdownRenderer content="![x](javascript:alert(1))" />,
    );
    const img = container.querySelector("img");
    expect(img).toBeTruthy();
    expect(img?.getAttribute("src")).toBeNull();
  });

  it("renders blockquotes", () => {
    const { container } = render(
      <BasicMarkdownRenderer content="> quoted text" />,
    );
    expect(container.querySelector("blockquote")?.textContent).toContain(
      "quoted text",
    );
  });

  it("renders ordered lists with a start offset", () => {
    const { container } = render(
      <BasicMarkdownRenderer content={"3. three\n4. four"} />,
    );
    const ol = container.querySelector("ol");
    expect(ol).toBeTruthy();
    expect(ol?.getAttribute("start")).toBe("3");
    expect(container.querySelectorAll("li")).toHaveLength(2);
  });

  it("rejects data:image/svg+xml image src (SVG script vector)", () => {
    const { container } = render(
      <BasicMarkdownRenderer
        content={"![x](data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=)"}
      />,
    );
    const img = container.querySelector("img");
    expect(img).toBeTruthy();
    expect(img?.getAttribute("src")).toBeNull();
  });

  it("still allows data:image/png image src", () => {
    const { container } = render(
      <BasicMarkdownRenderer
        content={"![x](data:image/png;base64,iVBORw0KGgo=)"}
      />,
    );
    expect(container.querySelector("img")?.getAttribute("src")).toContain(
      "data:image/png",
    );
  });
});
