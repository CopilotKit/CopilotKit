import React from "react";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { renderInlineMarkdown } from "../a2ui-react/catalog/standard/inline-markdown";

const html = (s: string) =>
  render(<span>{renderInlineMarkdown(s)}</span>).container.innerHTML;

describe("renderInlineMarkdown", () => {
  it("renders bold, italic, strikethrough, code and links", () => {
    const out = html("a **b** *c* ~~d~~ `e` [f](https://x.y)");
    expect(out).toContain("<strong>b</strong>");
    expect(out).toContain("<em>c</em>");
    expect(out).toContain("<s>d</s>");
    expect(out).toContain("<code>e</code>");
    expect(out).toContain('href="https://x.y"');
  });
  it("leaves plain text alone and escapes nothing twice", () => {
    expect(html("1 < 2 & 3")).toBe("<span>1 &lt; 2 &amp; 3</span>");
  });
  it("does not emit javascript: links", () => {
    expect(html("[x](javascript:alert(1))")).not.toContain("href=");
  });
  it("supports underscore italics and ++underline++", () => {
    const out = html("_i_ and ++u++");
    expect(out).toContain("<em>i</em>");
    expect(out).toContain("<u>u</u>");
  });
  it("leaves intra-word underscores alone", () => {
    expect(html("use snake_case_name")).toBe(
      "<span>use snake_case_name</span>",
    );
  });
  it("keeps code spans literal", () => {
    expect(html("`**x**`")).toContain("<code>**x**</code>");
  });
  it("renders unmatched markers as plain text", () => {
    expect(html("2 * 3 = 6 and a ** b")).toBe(
      "<span>2 * 3 = 6 and a ** b</span>",
    );
  });
  it("opens links in a new tab safely", () => {
    const out = html("[m](mailto:a@b.c)");
    expect(out).toContain('href="mailto:a@b.c"');
    expect(out).toContain('rel="noopener noreferrer"');
  });
});
