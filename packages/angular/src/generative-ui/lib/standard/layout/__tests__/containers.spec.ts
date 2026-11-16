import { afterEach, describe, expect, it, vi } from "vitest";
import { renderSurface, updateDataModel } from "../../../__tests__/render";
import { standardUI } from "../../index";
import { layoutStyle } from "../../style";
import { layoutComponents } from "../index";
import { byText } from "../../../__tests__/dom";
import { labelOf, parentOf, spacing, ui } from "./helpers";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("layoutComponents", () => {
  it("is valid input for createGenerativeUI, with a description and a children slot for every container", () => {
    const names = Object.keys(layoutComponents);
    expect(names).toEqual([
      "Box",
      "Column",
      "Row",
      "Grid",
      "GridItem",
      "Card",
      "Flow",
      "FlowItem",
      "Carousel",
      "CarouselItem",
      "CarouselMediaItem",
      "Spacer",
      "Divider",
      "Tabs",
    ]);
    for (const name of names) {
      expect(ui.manifestComponents[name]!.description).toMatch(/\S/);
    }
    expect(ui.manifestComponents.Column!.slots).toEqual({
      children: "multiple",
    });
    expect(ui.manifestComponents.Divider!.slots).toBeUndefined();
    expect(ui.manifestComponents.Column!.props).toMatchObject({
      properties: expect.not.objectContaining({ children: expect.anything() }),
    });
  });
});

describe("standard layout", () => {
  it("renders Box with gap and padding in 4px steps", () => {
    const view = renderSurface(ui, [
      {
        id: "root",
        component: "Box",
        gap: 2,
        padding: 3,
        border: true,
        radius: "lg",
        children: ["a"],
      },
      { id: "a", component: "Label", text: "Team plan" },
    ]);
    const box = parentOf(view, "Team plan");
    expect(box.tagName).toBe("DIV");
    expect(box.hasAttribute("data-a2ui-std")).toBe(true);
    expect(box.style.gap).toBe(spacing(2));
    expect(box.style.padding).toBe(spacing(3));
    expect(box.style.borderRadius).toBe("var(--a2ui-radius-lg, 12px)");
    expect(box.style.border).toContain("1px solid");
    expect(box.style.flexDirection).toBe("column");
  });

  it("spaces Row children 8px apart unless a gap is given", () => {
    const view = renderSurface(ui, [
      { id: "root", component: "Column", children: ["r1", "r2"] },
      { id: "r1", component: "Row", children: ["a"] },
      { id: "a", component: "Label", text: "auto" },
      { id: "r2", component: "Row", gap: 0, children: ["b"] },
      { id: "b", component: "Label", text: "none" },
    ]);
    expect(parentOf(view, "auto").style.gap).toBe(spacing(2));
    expect(parentOf(view, "none").style.gap).toBe(spacing(0));
  });

  it("applies the accessibility of the envelope to a container and a Card", () => {
    const view = renderSurface(ui, [
      {
        id: "root",
        component: "Column",
        children: ["c"],
        accessibility: { label: "Order", live: "polite" },
      },
      {
        id: "c",
        component: "Card",
        children: ["t"],
        accessibility: { description: "The items", hidden: true },
      },
      { id: "t", component: "Label", text: "inside" },
    ]);
    const card = parentOf(view, "inside");
    expect(card.getAttribute("aria-description")).toBe("The items");
    expect(card.getAttribute("aria-hidden")).toBe("true");
    const column = view.container.querySelector('[aria-label="Order"]');
    expect(column?.getAttribute("aria-live")).toBe("polite");
    expect(column?.contains(card)).toBe(true);
    // A generic element cannot carry a name: a named container is a group.
    expect(column?.getAttribute("role")).toBe("group");
    expect(card.getAttribute("role")).toBe("group");
  });

  it("gives a Card its default padding, radius and border", () => {
    const view = renderSurface(ui, [
      { id: "root", component: "Card", children: ["t"] },
      { id: "t", component: "Label", text: "inside" },
    ]);
    const card = parentOf(view, "inside");
    expect(card.dataset["a2uiCard"]).toBe("top");
    expect(card.style.padding).toBe(spacing(4));
    expect(card.style.borderRadius).toBe("var(--a2ui-radius-xl, 16px)");
    expect(card.style.border).toContain("1px solid");
  });

  it("renders the child slot of a Card before its children", () => {
    const view = renderSurface(ui, [
      { id: "root", component: "Card", child: "head", children: ["body"] },
      { id: "head", component: "Label", text: "Head" },
      { id: "body", component: "Label", text: "Body" },
    ]);
    const card = parentOf(view, "Head");
    expect([...card.children].map((el) => el.textContent?.trim())).toEqual([
      "Head",
      "Body",
    ]);
  });

  it("draws no box for a section Card, and a box for an outline Card in a Card", () => {
    const view = renderSurface(ui, [
      { id: "root", component: "Column", children: ["s", "p"] },
      { id: "s", component: "Card", variant: "section", children: ["st"] },
      { id: "st", component: "Label", text: "Section" },
      { id: "p", component: "Card", children: ["o"] },
      { id: "o", component: "Card", variant: "outline", children: ["ot"] },
      { id: "ot", component: "Label", text: "Outlined" },
    ]);
    const section = parentOf(view, "Section");
    expect(section.dataset["a2uiCardVariant"]).toBe("section");
    expect(section.getAttribute("style")).not.toContain("solid");
    expect(section.style.padding).toBe("0px");
    expect(section.style.gap).toBe(spacing(4));
    const outline = parentOf(view, "Outlined");
    expect(outline.dataset["a2uiCard"]).toBe("nested");
    expect(outline.style.border).toContain("1px solid");
  });

  it("keeps the border of a top-level Card and removes it from a nested one", () => {
    const view = renderSurface(ui, [
      { id: "root", component: "Card", children: ["inner"] },
      { id: "inner", component: "Card", padding: 4, children: ["t"] },
      { id: "t", component: "Label", text: "nested" },
    ]);
    const inner = parentOf(view, "nested");
    const outer = inner.parentElement!;
    expect(outer.dataset["a2uiCard"]).toBe("top");
    expect(outer.style.border).toContain("1px solid");
    expect(outer.style.gap).toBe(spacing(4));
    expect(inner.dataset["a2uiCard"]).toBe("nested");
    expect(inner.getAttribute("style")).not.toMatch(/border:[^;]*solid/);
    expect(inner.style.boxShadow).toBe("none");
    expect(inner.style.padding).toMatch(/^0(px)?$/);
    expect(inner.style.gap).toBe(spacing(3));
  });

  it("turns a nested Card with a background into the inner panel", () => {
    const view = renderSurface(ui, [
      { id: "root", component: "Card", children: ["a", "b"] },
      {
        id: "a",
        component: "Card",
        background: "surface-secondary",
        children: ["ta"],
      },
      { id: "ta", component: "Label", text: "neutral" },
      { id: "b", component: "Card", background: "success", children: ["tb"] },
      { id: "tb", component: "Label", text: "tinted" },
    ]);
    const neutral = parentOf(view, "neutral");
    expect(neutral.getAttribute("style")).not.toMatch(/border:[^;]*solid/);
    expect(neutral.style.padding).toBe(spacing(3));
    expect(neutral.style.borderRadius).toBe("var(--a2ui-radius-md, 8px)");
    expect(neutral.style.background).toContain("rgb(252, 252, 252)");
    const tinted = parentOf(view, "tinted");
    expect(tinted.style.background).toContain("rgba(0, 128, 93, 0.06)");
  });

  it("renders a bordered Box as the inner panel in a Card, and with a border outside of one", () => {
    const view = renderSurface(ui, [
      { id: "root", component: "Column", children: ["card", "plain"] },
      { id: "card", component: "Card", children: ["panel"] },
      { id: "panel", component: "Box", border: true, children: ["t1"] },
      { id: "t1", component: "Label", text: "panel" },
      { id: "plain", component: "Box", border: true, children: ["t2"] },
      { id: "t2", component: "Label", text: "plain" },
    ]);
    const panel = parentOf(view, "panel");
    expect(panel.getAttribute("style")).not.toMatch(/border:[^;]*solid/);
    expect(panel.style.padding).toBe(spacing(3));
    expect(panel.style.borderRadius).toBe("var(--a2ui-radius-md, 8px)");
    expect(panel.style.background).toContain("rgb(252, 252, 252)");
    expect(parentOf(view, "plain").style.border).toContain("1px solid");
  });

  it("uses 16px between the groups in a Card and 8px in a group", () => {
    const view = renderSurface(ui, [
      { id: "root", component: "Card", children: ["group"] },
      { id: "group", component: "Column", children: ["inner"] },
      { id: "inner", component: "Column", children: ["t"] },
      { id: "t", component: "Label", text: "deep" },
    ]);
    const inner = parentOf(view, "deep");
    const group = inner.parentElement!;
    expect(group.style.gap).toBe(spacing(4));
    expect(inner.style.gap).toBe(spacing(2));
  });

  it("layout props: flush removes padding, disableAutoSpacing removes the default gap, role is applied", () => {
    const view = renderSurface(ui, [
      { id: "root", component: "Column", children: ["c"] },
      {
        id: "c",
        component: "Card",
        flush: true,
        disableAutoSpacing: true,
        role: "group",
        children: ["t"],
      },
      { id: "t", component: "Label", text: "Inside" },
    ]);
    const card = parentOf(view, "Inside");
    expect(card.getAttribute("role")).toBe("group");
    expect(["0", "0px"]).toContain(card.style.padding);
    expect(["0", "0px"]).toContain(card.style.gap);
  });

  it("minSize and maxSize set both dimensions of a container", () => {
    const view = renderSurface(ui, [
      {
        id: "root",
        component: "Box",
        minSize: 10,
        maxSize: 40,
        children: ["t"],
      },
      { id: "t", component: "Label", text: "Sized" },
    ]);
    const box = parentOf(view, "Sized");
    expect(box.style.minWidth).toBe(spacing(10));
    expect(box.style.minHeight).toBe(spacing(10));
    expect(box.style.maxWidth).toBe(spacing(40));
    expect(box.style.maxHeight).toBe(spacing(40));
  });

  it("Card size and shadowStyle presets apply", () => {
    const view = renderSurface(ui, [
      {
        id: "root",
        component: "Card",
        size: "sm",
        shadowStyle: "md",
        children: ["t"],
      },
      { id: "t", component: "Label", text: "Small" },
    ]);
    const card = parentOf(view, "Small");
    expect(card.style.padding).toBe(spacing(2));
    expect(card.style.boxShadow).toContain("--a2ui-shadow-md");
  });

  it("renders a Divider as a rule and hides a Spacer from screen readers", () => {
    const view = renderSurface(ui, [
      { id: "root", component: "Column", children: ["d", "s", "t"] },
      { id: "d", component: "Divider", color: "strong" },
      { id: "s", component: "Spacer", minSize: 8 },
      { id: "t", component: "Label", text: "after" },
    ]);
    const rule = view.container.querySelector("hr")!;
    expect(rule).not.toBeNull();
    expect(rule.style.borderTop).toContain("--a2ui-color-border-strong");
    const spacer = view.container.querySelector<HTMLElement>(
      '[aria-hidden="true"]',
    )!;
    expect(spacer.tagName).toBe("DIV");
    expect(spacer.style.minHeight).toBe(spacing(8));
  });

  it("makes a scrollable container focusable and leaves others out of the tab order", () => {
    const view = renderSurface(ui, [
      { id: "root", component: "Column", children: ["s", "p"] },
      { id: "s", component: "Column", scrollable: true, children: ["a"] },
      { id: "a", component: "Label", text: "scrolls" },
      { id: "p", component: "Column", children: ["b"] },
      { id: "b", component: "Label", text: "static" },
    ]);
    const scroller = parentOf(view, "scrolls");
    expect(scroller.tabIndex).toBe(0);
    expect(scroller.hasAttribute("data-a2ui-scroll")).toBe(true);
    expect(scroller.style.overflow).toBe("auto");
    expect(parentOf(view, "static").hasAttribute("tabindex")).toBe(false);
  });

  it.each(["Column", "Grid", "Card", "Row", "Box", "Carousel", "Flow"])(
    "%s repeats a template child for each data item",
    (component) => {
      const view = renderSurface(
        ui,
        [
          {
            id: "root",
            component,
            children: { componentId: "row", path: "/items" },
          },
          { id: "row", component: "Label", text: { "@path": "name" } },
        ],
        { items: [{ name: "Alpha" }, { name: "Beta" }] },
      );
      expect(labelOf(view, "Alpha").parentElement).toBe(
        labelOf(view, "Beta").parentElement,
      );
    },
  );

  it("adds a template item to a Column when the list grows", () => {
    const view = renderSurface(
      ui,
      [
        {
          id: "root",
          component: "Column",
          children: { componentId: "row", path: "/items" },
        },
        { id: "row", component: "Label", text: { "@path": "name" } },
      ],
      { items: [{ name: "Alpha" }] },
    );
    view.update(updateDataModel("/items/1", { name: "Beta" }));
    const column = parentOf(view, "Beta");
    expect(
      [...column.children].map((child) => child.textContent?.trim()),
    ).toEqual(["Alpha", "Beta"]);
  });

  it("onVisible dispatches once when the container becomes visible", () => {
    let callback:
      | ((entries: Array<{ isIntersecting: boolean }>) => void)
      | null = null;
    class FakeObserver {
      constructor(cb: typeof callback) {
        callback = cb;
      }
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    const view = renderSurface(ui, [
      {
        id: "root",
        component: "Column",
        onVisible: { event: { name: "seen" } },
        children: ["t"],
      },
      { id: "t", component: "Label", text: "Hi" },
    ]);
    view.detectChanges();
    expect(callback).not.toBeNull();
    callback!([{ isIntersecting: true }]);
    callback!([{ isIntersecting: true }]);
    expect(view.forwardEvent).toHaveBeenCalledTimes(1);
    expect(view.forwardEvent.mock.calls[0]![0].name).toBe("seen");
  });
});

describe("standard catalog: layout (parity)", () => {
  it("centres Row children by default and keeps text from stretching", () => {
    const v = renderSurface(standardUI, [
      { id: "root", component: "Column", children: ["r1", "r2"] },
      {
        id: "r1",
        component: "Row",
        justify: "spaceBetween",
        children: ["k", "val"],
      },
      { id: "k", component: "Text", text: "Price" },
      { id: "val", component: "Text", text: "$29.00", tabularNums: true },
      { id: "r2", component: "Row", align: "start", children: ["s"] },
      { id: "s", component: "Text", text: "top" },
    ]);
    const value = byText(v.container, "$29.00");
    const row = value.parentElement!;
    expect(row.style.alignItems).toBe("center");
    expect(row.dataset["a2uiRow"]).toBe("spaceBetween");
    expect(value.style.flex).toBe("0 1 auto");
    expect(value.style.minWidth).toMatch(/^0(px)?$/);
    expect(value.style.width).toBe("");
    expect(value.style.fontVariantNumeric).toBe("tabular-nums");
    expect(byText(v.container, "top").parentElement!.style.alignItems).toBe(
      "flex-start",
    );
  });
});

describe("layout helpers", () => {
  it("layoutStyle never has an undefined key, so it never resets the gap shorthand", () => {
    const style = layoutStyle({ gap: 4 });
    expect(Object.values(style)).not.toContain(undefined);
    expect("rowGap" in style).toBe(false);
    expect(style["gap"]).toBe(spacing(4));
  });
});
