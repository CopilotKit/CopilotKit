import React from "react";
import { act, fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createGenerativeUI } from "../../catalog";
import { layoutComponents } from "../layout";
import {
  parseBlockMarkdown,
  renderBlockMarkdown,
  renderInlineMarkdown,
} from "../markdown";
import { textComponents } from "../text";
import { SURFACE_ID, renderSurface } from "./render";

const ui = createGenerativeUI({
  id: "test/text@1",
  components: { ...layoutComponents, ...textComponents },
});

const inlineHtml = (source: string) =>
  render(<span>{renderInlineMarkdown(source)}</span>).container.innerHTML;

describe("textComponents", () => {
  it("is valid input for createGenerativeUI, with a description for every component", () => {
    const names = Object.keys(textComponents);
    expect(names).toEqual([
      "Title",
      "Text",
      "Caption",
      "Label",
      "Bold",
      "Italic",
      "Underline",
      "Strikethrough",
      "Badge",
      "Blockquote",
      "Code",
      "Markdown",
      "Math",
      "ShimmerText",
      "Link",
      "Tooltip",
    ]);
    for (const name of names) {
      expect(ui.manifestComponents[name].description).toMatch(/\S/);
    }
    expect(ui.manifestComponents.Text.slots).toEqual({ children: "multiple" });
    expect(ui.manifestComponents.Tooltip.slots).toEqual({
      trigger: "single",
      content: "single",
    });
    expect(ui.manifestComponents.Text.props).toMatchObject({
      properties: expect.not.objectContaining({ children: expect.anything() }),
    });
  });
});

describe("standard text", () => {
  it("renders a Title and a Text with inline markdown", async () => {
    const view = renderSurface(ui, [
      { id: "root", component: "Column", children: ["t", "x"] },
      { id: "t", component: "Title", text: "Team plan", size: "xl" },
      {
        id: "x",
        component: "Text",
        text: "Was ~~$39~~ now **$29**",
        color: "secondary",
      },
    ]);
    await view.findByText("Team plan");
    expect(view.container.querySelector("s")?.textContent).toBe("$39");
    expect(view.container.querySelector("strong")?.textContent).toBe("$29");
  });

  it("updates a Text bound to { path } when the data model changes", async () => {
    const view = renderSurface(
      ui,
      [{ id: "root", component: "Text", text: { path: "/price" } }],
      { price: "$290" },
    );
    await view.findByText("$290");
    view.update({
      version: "v0.9",
      updateDataModel: { surfaceId: SURFACE_ID, path: "/price", value: "$310" },
    });
    await view.findByText("$310");
    expect(view.queryByText("$290")).toBeNull();
  });

  it("maps Title sizes to heading levels", async () => {
    const view = renderSurface(ui, [
      { id: "root", component: "Column", children: ["a", "b", "c", "d"] },
      { id: "a", component: "Title", text: "small", size: "sm" },
      { id: "b", component: "Title", text: "default" },
      { id: "c", component: "Title", text: "large", size: "lg" },
      { id: "d", component: "Title", text: "huge", size: "5xl" },
    ]);
    expect((await view.findByText("small")).tagName).toBe("H4");
    expect(view.getByText("default").tagName).toBe("H3");
    expect(view.getByText("large").tagName).toBe("H3");
    expect(view.getByText("huge").tagName).toBe("H2");
  });

  it("takes the Title size, line height and weight from the host heading styles", async () => {
    const view = renderSurface(ui, [
      { id: "root", component: "Column", children: ["a", "b"] },
      { id: "a", component: "Title", text: "Breakdown", size: "2xl" },
      {
        id: "b",
        component: "Title",
        text: "Muted",
        color: "secondary",
        textAlign: "center",
      },
    ]);
    const heading = await view.findByText("Breakdown");
    expect(heading.style.fontSize).toBe("");
    expect(heading.style.lineHeight).toBe("");
    expect(heading.style.fontWeight).toBe("");
    expect(heading.style.margin).toBe("");
    const muted = view.getByText("Muted");
    expect(muted.style.color).toContain("--a2ui-color-text-secondary");
    expect(muted.style.textAlign).toBe("center");
  });

  it("lets Text inherit its size unless a size is given, and sizes Caption and Label in em", async () => {
    const view = renderSurface(ui, [
      { id: "root", component: "Column", children: ["a", "b", "c", "d"] },
      { id: "a", component: "Text", text: "plain" },
      { id: "b", component: "Text", text: "small", size: "sm" },
      { id: "c", component: "Caption", text: "caption" },
      { id: "d", component: "Label", text: "label" },
    ]);
    const plain = await view.findByText("plain");
    expect(plain.style.fontSize).toBe("");
    expect(plain.style.lineHeight).toBe("");
    expect(plain.style.color).toBe("");
    expect(view.getByText("small").style.fontSize).toBe("0.875em");
    const caption = view.getByText("caption");
    expect(caption.style.fontSize).toBe("0.875em");
    expect(caption.style.color).toContain("--a2ui-color-text-secondary");
    const label = view.getByText("label");
    expect(label.tagName).toBe("LABEL");
    expect(label.style.fontSize).toBe("0.875em");
    expect(label.style.fontWeight).toBe("500");
  });

  it("renders the children of a Text inline after its text", async () => {
    const view = renderSurface(ui, [
      { id: "root", component: "Text", text: "Plan", children: ["b"] },
      { id: "b", component: "Badge", label: "Pro" },
    ]);
    const badge = await view.findByText("Pro");
    const text = badge.closest("span[data-a2ui-text]");
    expect(text?.textContent).toBe("Plan Pro");
  });

  it("renders Badge, Bold, Code and a safe Link", async () => {
    const view = renderSurface(ui, [
      { id: "root", component: "Column", children: ["b", "o", "k", "a"] },
      { id: "b", component: "Badge", label: "New", color: "success" },
      { id: "o", component: "Bold", text: "loud" },
      { id: "k", component: "Code", text: "x = 1", language: "js" },
      {
        id: "a",
        component: "Link",
        text: "docs",
        href: "https://copilotkit.ai",
      },
    ]);
    const badge = await view.findByText("New");
    expect(badge.style.color).toContain("--a2ui-color-text-success");
    expect(view.getByText("loud").tagName).toBe("STRONG");
    const code = view.getByText("x = 1");
    expect(code.dataset.language).toBe("js");
    expect(code.closest("pre")?.tabIndex).toBe(0);
    const link = view.getByRole("link", { name: "docs (opens in a new tab)" });
    expect(link.getAttribute("href")).toBe("https://copilotkit.ai");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("renders a Link with a javascript: href as plain text", async () => {
    const view = renderSurface(ui, [
      {
        id: "root",
        component: "Link",
        text: "bad",
        href: "javascript:alert(1)",
      },
    ]);
    expect((await view.findByText("bad")).tagName).toBe("SPAN");
    expect(view.queryByRole("link")).toBeNull();
  });

  it("renders Markdown with Streamdown and no typography of its own", async () => {
    const view = renderSurface(ui, [
      {
        id: "root",
        component: "Markdown",
        text: "# Title\n\nSome **bold** text.\n\n- one\n- two\n\n> quoted",
      },
    ]);
    const heading = await view.findByRole("heading", { level: 1 });
    expect(heading.textContent).toBe("Title");
    // Streamdown marks bold text with its own element, as in the chat.
    expect(view.getByText("bold").dataset.streamdown).toBe("strong");
    const items = view.container.querySelectorAll("ul li");
    expect([...items].map((item) => item.textContent)).toEqual(["one", "two"]);
    expect(view.container.querySelector("blockquote")?.textContent).toContain(
      "quoted",
    );
    const markdown = heading.closest(".a2ui-markdown");
    expect(markdown?.getAttribute("style")).toBeNull();
    expect(items[0].closest("ul")?.classList.contains("a2ui-std-list")).toBe(
      false,
    );
  });

  it("typesets Math with KaTeX, inline and as a block", async () => {
    const view = renderSurface(ui, [
      { id: "root", component: "Column", children: ["i", "b"] },
      { id: "i", component: "Math", value: "x^2" },
      { id: "b", component: "Math", value: "\\frac{a}{b}", block: true },
    ]);
    await view.findAllByText("x");
    const inline = view.container.querySelector('[data-math="inline"]');
    expect(inline?.tagName).toBe("SPAN");
    expect(inline?.querySelector(".katex math")).not.toBeNull();
    expect(inline?.querySelector(".katex-display")).toBeNull();
    const block = view.container.querySelector('[data-math="block"]');
    expect(block?.tagName).toBe("DIV");
    expect(block?.querySelector(".katex-display mfrac")).not.toBeNull();
  });

  it("shows invalid TeX as source text instead of failing", async () => {
    const view = renderSurface(ui, [
      { id: "root", component: "Math", value: "\\frac{a" },
    ]);
    const error = await view.findByText("\\frac{a");
    expect(error.classList.contains("katex-error")).toBe(true);
  });

  it("renders ShimmerText with a shimmer that stops for reduced motion", async () => {
    const view = renderSurface(ui, [
      { id: "root", component: "ShimmerText", text: "Thinking" },
    ]);
    const shimmer = await view.findByText("Thinking");
    expect(shimmer.style.animation).toContain("a2ui-shimmer");
    expect(document.head.innerHTML).toContain(
      "@media (prefers-reduced-motion:reduce){[data-a2ui-shimmer]{animation:none!important}}",
    );
  });

  it("shows the Tooltip content on focus and on hover, and hides it on Escape", async () => {
    const view = renderSurface(ui, [
      { id: "root", component: "Tooltip", trigger: "t", content: "c" },
      { id: "t", component: "Badge", label: "Beta" },
      { id: "c", component: "Text", text: "Not stable yet" },
    ]);
    const trigger = (await view.findByText("Beta")).closest(
      "[data-a2ui-tooltip-trigger]",
    );
    if (!(trigger instanceof HTMLElement)) throw new Error("No trigger.");
    const tooltip = view.getByRole("tooltip", { hidden: true });
    expect(tooltip.textContent).toBe("Not stable yet");
    expect(trigger.getAttribute("aria-describedby")).toBe(tooltip.id);
    expect(tooltip.hidden).toBe(true);

    act(() => trigger.focus());
    expect(tooltip.hidden).toBe(false);
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(tooltip.hidden).toBe(true);
    act(() => trigger.blur());

    fireEvent.mouseEnter(trigger);
    expect(tooltip.hidden).toBe(false);
    fireEvent.mouseLeave(trigger.parentElement ?? trigger);
    expect(tooltip.hidden).toBe(true);
  });
});

describe("renderInlineMarkdown", () => {
  it("renders bold, italic, strikethrough, code and links", () => {
    const html = inlineHtml("a **b** *c* ~~d~~ `e` [f](https://x.y)");
    expect(html).toContain("<strong>b</strong>");
    expect(html).toContain("<em>c</em>");
    expect(html).toContain("<s>d</s>");
    expect(html).toContain("<code>e</code>");
    expect(html).toContain('href="https://x.y"');
  });

  it("leaves plain text alone and escapes it once", () => {
    expect(inlineHtml("1 < 2 & 3")).toBe("<span>1 &lt; 2 &amp; 3</span>");
  });

  it("does not make a link of a javascript: URL", () => {
    const html = inlineHtml("[x](javascript:alert(1))");
    expect(html).not.toContain("href=");
    expect(html).toBe("<span>x</span>");
  });

  it("supports underscore italics and ++underline++", () => {
    const html = inlineHtml("_i_ and ++u++");
    expect(html).toContain("<em>i</em>");
    expect(html).toContain("<u>u</u>");
  });

  it("leaves underscores inside a word alone", () => {
    expect(inlineHtml("use snake_case_name")).toBe(
      "<span>use snake_case_name</span>",
    );
  });

  it("keeps code spans literal", () => {
    expect(inlineHtml("`**x**`")).toContain("<code>**x**</code>");
  });

  it("renders unmatched markers as plain text", () => {
    expect(inlineHtml("2 * 3 = 6 and a ** b")).toBe(
      "<span>2 * 3 = 6 and a ** b</span>",
    );
  });

  it("opens links in a new tab, safely, and says so to screen readers", () => {
    const html = inlineHtml("[m](mailto:a@b.c)");
    expect(html).toContain('href="mailto:a@b.c"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain("(opens in a new tab)");
  });
});

describe("block markdown", () => {
  it("parses blocks: joins paragraph lines, keeps fences verbatim, adds no empty paragraphs", () => {
    expect(
      parseBlockMarkdown("a\nb\n\n```\n# not a heading\n```\n\n\n"),
    ).toEqual([
      { kind: "paragraph", text: "a b" },
      { kind: "code", text: "# not a heading" },
    ]);
  });

  it("renders headings, lists, quotes, code and rules", () => {
    const view = render(
      <div>
        {renderBlockMarkdown(
          "# Title\n\nSome **bold** text.\n\n- one\n- two\n\n1. first\n2. second\n\n> quoted\n\n```js\nx = 1\n```\n\n---",
        )}
      </div>,
    );
    expect(view.getByText("Title").tagName).toBe("H1");
    expect(view.container.querySelector("strong")?.textContent).toBe("bold");
    expect(view.container.querySelectorAll("ul li")).toHaveLength(2);
    expect(view.container.querySelectorAll("ol li")).toHaveLength(2);
    expect(view.getByText("quoted").tagName).toBe("BLOCKQUOTE");
    expect(view.getByText("x = 1").dataset.language).toBe("js");
    expect(view.container.querySelector("hr")).not.toBeNull();
  });
});
