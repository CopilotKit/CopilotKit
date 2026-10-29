import { describe, expect, it } from "vitest";
import {
  renderSurface,
  updateComponents,
  updateDataModel,
} from "../../../__tests__/render";
import { standardUI } from "../../index";
import { textComponents } from "..";
import { byText, ui } from "./helpers";

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
      expect(ui.manifestComponents[name]?.description).toMatch(/\S/);
    }
    expect(ui.manifestComponents.Text?.slots).toEqual({ children: "multiple" });
    expect(ui.manifestComponents.Tooltip?.slots).toEqual({
      trigger: "single",
      content: "single",
    });
    expect(ui.manifestComponents.Text?.props).toMatchObject({
      properties: expect.not.objectContaining({ children: expect.anything() }),
    });
  });
});

describe("standard text", () => {
  it("renders a Title and a Text with inline markdown", () => {
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
    expect(byText(view.container, "Team plan").tagName).toBe("H2");
    expect(view.container.querySelector("s")?.textContent).toBe("$39");
    expect(view.container.querySelector("strong")?.textContent).toBe("$29");
    const text = view.container.querySelector<HTMLElement>("[data-a2ui-text]")!;
    expect(text.textContent).toBe("Was $39 now $29");
    expect(text.style.color).toContain("--a2ui-color-text-secondary");
  });

  it('updates a Text bound to { "@path" } when the data model changes', () => {
    const view = renderSurface(
      ui,
      [{ id: "root", component: "Text", text: { "@path": "/price" } }],
      { price: "$290" },
    );
    const text = view.container.querySelector("[data-a2ui-text]")!;
    expect(text.textContent).toBe("$290");
    view.update(updateDataModel("/price", "$310"));
    expect(text.textContent).toBe("$310");
  });

  it("maps Title sizes to heading levels", () => {
    const view = renderSurface(ui, [
      { id: "root", component: "Column", children: ["a", "b", "c", "d"] },
      { id: "a", component: "Title", text: "small", size: "sm" },
      { id: "b", component: "Title", text: "default" },
      { id: "c", component: "Title", text: "large", size: "lg" },
      { id: "d", component: "Title", text: "huge", size: "5xl" },
    ]);
    expect(byText(view.container, "small").tagName).toBe("H4");
    expect(byText(view.container, "default").tagName).toBe("H3");
    expect(byText(view.container, "large").tagName).toBe("H3");
    expect(byText(view.container, "huge").tagName).toBe("H2");
    expect(byText(view.container, "huge").getAttribute("data-a2ui-title")).toBe(
      "5xl",
    );
    // The heading is the host itself, in the Column, as in React.
    expect(byText(view.container, "small").parentElement).toBe(
      byText(view.container, "huge").parentElement,
    );
    // A new size is a new element.
    view.update(
      updateComponents({
        id: "d",
        component: "Title",
        text: "huge",
        size: "sm",
      }),
    );
    expect(byText(view.container, "huge").tagName).toBe("H4");
  });

  it("takes the Title size, line height and weight from the host heading styles", () => {
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
    const heading = byText(view.container, "Breakdown");
    expect(heading.style.fontSize).toBe("");
    expect(heading.style.lineHeight).toBe("");
    expect(heading.style.fontWeight).toBe("");
    expect(heading.style.margin).toBe("");
    const muted = byText(view.container, "Muted");
    expect(muted.style.color).toContain("--a2ui-color-text-secondary");
    expect(muted.style.textAlign).toBe("center");
  });

  it("lets Text inherit its size unless a size is given, and sizes Caption and Label in em", () => {
    const view = renderSurface(ui, [
      { id: "root", component: "Column", children: ["a", "b", "c", "d"] },
      { id: "a", component: "Text", text: "plain" },
      { id: "b", component: "Text", text: "small", size: "sm" },
      { id: "c", component: "Caption", text: "caption" },
      { id: "d", component: "Label", text: "label" },
    ]);
    const plain =
      view.container.querySelectorAll<HTMLElement>("[data-a2ui-text]")[0]!;
    expect(plain.style.fontSize).toBe("");
    expect(plain.style.lineHeight).toBe("");
    expect(plain.style.color).toBe("");
    const small =
      view.container.querySelectorAll<HTMLElement>("[data-a2ui-text]")[1]!;
    expect(small.style.fontSize).toBe("0.875em");
    const caption = byText(view.container, "caption");
    expect(caption.style.fontSize).toBe("0.875em");
    expect(caption.style.color).toContain("--a2ui-color-text-secondary");
    const label = byText(view.container, "label");
    expect(label.tagName).toBe("LABEL");
    expect(label.style.fontSize).toBe("0.875em");
    expect(label.style.fontWeight).toBe("500");
  });

  it("renders the children of a Text inline after its text", () => {
    const view = renderSurface(ui, [
      { id: "root", component: "Text", text: "Plan", children: ["b"] },
      { id: "b", component: "Badge", label: "Pro" },
    ]);
    const text = view.container.querySelector("span[data-a2ui-text]");
    expect(text?.textContent).toBe("Plan Pro");
    expect(text?.querySelector("span")?.textContent).toBe("Pro");
  });

  it("renders Badge, Bold, Code and a safe Link", () => {
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
    const badge = byText(view.container, "New");
    expect(badge.style.color).toContain("--a2ui-color-text-success");
    expect(badge.style.borderRadius).toBe("9999px");
    expect(byText(view.container, "loud").tagName).toBe("STRONG");
    const code = byText(view.container, "x = 1");
    expect(code.dataset.language).toBe("js");
    expect(code.closest("pre")?.tabIndex).toBe(0);
    expect(code.closest("pre")?.hasAttribute("data-a2ui-scroll")).toBe(true);
    const link = view.container.querySelector("a[href]")!;
    expect(link.textContent).toBe("docs (opens in a new tab)");
    expect(link.getAttribute("href")).toBe("https://copilotkit.ai");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("renders a Link with a javascript: href as plain text", () => {
    const view = renderSurface(ui, [
      {
        id: "root",
        component: "Link",
        text: "bad",
        href: "javascript:alert(1)",
      },
    ]);
    const anchor = view.container.querySelector("a")!;
    expect(anchor.textContent).toBe("bad");
    expect(anchor.hasAttribute("href")).toBe(false);
    expect(anchor.hasAttribute("target")).toBe(false);
  });

  it("renders ShimmerText with a shimmer that stops for reduced motion", () => {
    const view = renderSurface(ui, [
      { id: "root", component: "ShimmerText", text: "Thinking" },
    ]);
    const shimmer = byText(view.container, "Thinking");
    expect(shimmer.hasAttribute("data-a2ui-shimmer")).toBe(true);
    expect(shimmer.style.animation).toContain("a2ui-shimmer");
    expect(document.head.innerHTML).toContain(
      "@media (prefers-reduced-motion:reduce){[data-a2ui-shimmer]{animation:none!important}}",
    );
  });

  it("applies the accessibility envelope to a Text", () => {
    const view = renderSurface(ui, [
      {
        id: "root",
        component: "Text",
        text: "Total",
        accessibility: { label: "Grand total", live: "polite" },
      },
    ]);
    const text = view.container.querySelector("[data-a2ui-text]")!;
    expect(text.getAttribute("aria-label")).toBe("Grand total");
    expect(text.getAttribute("aria-live")).toBe("polite");
  });
});

/**
 * Tests ported from the a2ui-renderer standard catalog, on the full
 * catalog, so the behaviour that catalog had is kept on the engine.
 */
describe("standard catalog: text (parity)", () => {
  it("Italic, Underline and Strikethrough render as inline elements", () => {
    const v = renderSurface(standardUI, [
      { id: "root", component: "Text", text: "Was", children: ["i", "u", "s"] },
      { id: "i", component: "Italic", text: "it" },
      { id: "u", component: "Underline", text: "un" },
      { id: "s", component: "Strikethrough", text: "st" },
    ]);
    expect(byText(v.container, "it").tagName).toBe("EM");
    expect(byText(v.container, "un").tagName).toBe("U");
    expect(byText(v.container, "st").tagName).toBe("S");
  });

  it("Blockquote renders inline markdown in its text", () => {
    const v = renderSurface(standardUI, [
      { id: "root", component: "Blockquote", text: "A **bold** claim" },
    ]);
    const strong = byText(v.container, "bold");
    expect(strong.tagName).toBe("STRONG");
    expect(strong.closest("blockquote")!.style.borderLeft).toContain(
      "3px solid",
    );
  });

  it("Text fontSize, lineHeight and minLines", () => {
    const v = renderSurface(standardUI, [
      {
        id: "root",
        component: "Text",
        text: "Tall",
        fontSize: 18,
        lineHeight: 1.2,
        minLines: 3,
      },
    ]);
    const el = byText(v.container, "Tall");
    expect(el.style.fontSize).toBe("18px");
    expect(el.style.lineHeight).toBe("1.2");
    expect(el.style.minHeight).toBe("4.5em");
  });
});
