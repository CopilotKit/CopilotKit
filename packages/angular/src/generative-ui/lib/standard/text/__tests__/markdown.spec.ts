import { beforeAll, describe, expect, it } from "vitest";
import { renderSurface } from "../../../__tests__/render";
import { preloadMathRenderer, safeHref } from "..";
import { renderInline, ui } from "./helpers";

describe("standard text", () => {
  // KaTeX loads on first use; the Math assertions need it.
  beforeAll(() => preloadMathRenderer());

  it("renders Markdown with the chat renderer and no typography of its own", () => {
    const view = renderSurface(ui, [
      {
        id: "root",
        component: "Markdown",
        text: "# Title\n\nSome **bold** text.\n\n- one\n- two\n\n1. first\n2. second\n\n> quoted\n\n```js\nx = 1\n```\n\n---",
      },
    ]);
    const markdown =
      view.container.querySelector<HTMLElement>(".a2ui-markdown")!;
    expect(markdown.getAttribute("style")).toBeNull();
    expect(markdown.hasAttribute("data-a2ui-std")).toBe(true);
    expect(markdown.querySelector("h1")?.textContent).toBe("Title");
    expect(markdown.querySelector("strong")?.textContent).toBe("bold");
    const items = markdown.querySelectorAll("ul li");
    expect([...items].map((item) => item.textContent)).toEqual(["one", "two"]);
    expect(markdown.querySelectorAll("ol li")).toHaveLength(2);
    expect(markdown.querySelector("blockquote")?.textContent).toContain(
      "quoted",
    );
    expect(markdown.querySelector("code")?.textContent).toContain("x = 1");
    expect(markdown.querySelector("hr")).not.toBeNull();
    expect(items[0]?.closest("ul")?.classList.contains("a2ui-std-list")).toBe(
      false,
    );
  });

  it("typesets Math with KaTeX, inline and as a block", () => {
    const view = renderSurface(ui, [
      { id: "root", component: "Column", children: ["i", "b"] },
      { id: "i", component: "Math", value: "x^2" },
      { id: "b", component: "Math", value: "\\frac{a}{b}", block: true },
    ]);
    const inline = view.container.querySelector<HTMLElement>(
      '[data-math="inline"]',
    )!;
    expect(inline.style.display).toBe("");
    expect(inline.querySelector(".katex math")).not.toBeNull();
    expect(inline.querySelector(".katex-display")).toBeNull();
    const block = view.container.querySelector<HTMLElement>(
      '[data-math="block"]',
    )!;
    expect(block.style.display).toBe("block");
    expect(block.querySelector(".katex-display mfrac")).not.toBeNull();
  });

  it("shows invalid TeX as source text instead of failing", () => {
    const view = renderSurface(ui, [
      { id: "root", component: "Math", value: "\\frac{a" },
    ]);
    const error = view.container.querySelector(".katex-error");
    expect(error?.textContent).toBe("\\frac{a");
    expect(
      view.container.querySelector("[data-generative-ui-error]"),
    ).toBeNull();
  });
});

describe("inline markdown", () => {
  it("renders bold, italic, strikethrough, code and links", () => {
    const text = renderInline("a **b** *c* ~~d~~ `e` [f](https://x.y)");
    expect(text.querySelector("strong")?.textContent).toBe("b");
    expect(text.querySelector("em")?.textContent).toBe("c");
    expect(text.querySelector("s")?.textContent).toBe("d");
    expect(text.querySelector("code")?.textContent).toBe("e");
    expect(text.querySelector("a")?.getAttribute("href")).toBe("https://x.y");
  });

  it("leaves plain text alone and escapes it once", () => {
    const text = renderInline("1 < 2 & 3");
    expect(text.textContent).toBe("1 < 2 & 3");
    expect(text.innerHTML).toContain("1 &lt; 2 &amp; 3");
    expect(text.children).toHaveLength(0);
  });

  it("renders nothing for an empty text", () => {
    expect(renderInline("").textContent?.trim()).toBe("");
  });

  it("does not make a link of a javascript: URL", () => {
    const text = renderInline("[x](javascript:alert(1))");
    expect(text.querySelector("a")).toBeNull();
    expect(text.textContent).toBe("x");
    expect(safeHref("javascript:alert(1)")).toBeUndefined();
    expect(safeHref(" mailto:a@b.c ")).toBe("mailto:a@b.c");
  });

  it("supports underscore italics and ++underline++", () => {
    const text = renderInline("_i_ and ++u++");
    expect(text.querySelector("em")?.textContent).toBe("i");
    expect(text.querySelector("u")?.textContent).toBe("u");
  });

  it("leaves underscores inside a word alone", () => {
    const text = renderInline("use snake_case_name");
    expect(text.textContent).toBe("use snake_case_name");
    expect(text.querySelector("em")).toBeNull();
  });

  it("keeps code spans literal", () => {
    const text = renderInline("`**x**`");
    expect(text.querySelector("code")?.textContent).toBe("**x**");
    expect(text.querySelector("strong")).toBeNull();
  });

  it("renders unmatched markers as plain text", () => {
    const text = renderInline("2 * 3 = 6 and a ** b");
    expect(text.textContent).toBe("2 * 3 = 6 and a ** b");
    expect(text.children).toHaveLength(0);
  });

  it("opens links in a new tab, safely, and says so to screen readers", () => {
    const link = renderInline("[m](mailto:a@b.c)").querySelector("a")!;
    expect(link.getAttribute("href")).toBe("mailto:a@b.c");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link.textContent).toBe("m (opens in a new tab)");
  });
});
