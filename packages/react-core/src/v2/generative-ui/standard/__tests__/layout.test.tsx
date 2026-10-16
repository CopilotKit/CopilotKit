import React from "react";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createGenerativeUI } from "../../catalog";
import { layoutComponents, layoutStyle } from "../layout";
import { SURFACE_ID, renderSurface } from "./render";

/** A test-only text leaf, so the layout tests need no other group. */
function Label({ text }: { text: string }) {
  return <span>{text}</span>;
}

const ui = createGenerativeUI({
  id: "test/layout@1",
  components: {
    ...layoutComponents,
    Label: { component: Label, props: z.object({ text: z.string() }) },
  },
});

const spacing = (steps: number) => `calc(var(--spacing, 0.25rem) * ${steps})`;

/** The container around the Label with this text. */
async function parentOf(view: ReturnType<typeof renderSurface>, text: string) {
  const label = await view.findByText(text);
  const parent = label.parentElement;
  if (!parent) throw new Error(`"${text}" has no parent element.`);
  return parent;
}

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
      "Animate",
      "AnimateGroup",
      "AnimateItem",
      "Transition",
    ]);
    for (const name of names) {
      expect(ui.manifestComponents[name].description).toMatch(/\S/);
    }
    expect(ui.manifestComponents.Column.slots).toEqual({
      children: "multiple",
    });
    expect(ui.manifestComponents.Divider.slots).toBeUndefined();
    expect(ui.manifestComponents.Column.props).toMatchObject({
      properties: expect.not.objectContaining({ children: expect.anything() }),
    });
  });
});

describe("standard layout", () => {
  it("renders Box with gap and padding in 4px steps", async () => {
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
    const box = await parentOf(view, "Team plan");
    expect(box.style.gap).toBe(spacing(2));
    expect(box.style.padding).toBe(spacing(3));
    expect(box.style.borderRadius).toBe("var(--a2ui-radius-lg, 12px)");
    expect(box.style.border).toContain("1px solid");
  });

  it("lays a Row out horizontally and gives a Grid its column count", async () => {
    const view = renderSurface(ui, [
      { id: "root", component: "Column", children: ["r", "g"] },
      { id: "r", component: "Row", justify: "between", children: ["a"] },
      { id: "a", component: "Label", text: "A" },
      { id: "g", component: "Grid", columns: 3, children: ["b"] },
      { id: "b", component: "GridItem", span: 2, children: ["c"] },
      { id: "c", component: "Label", text: "C" },
    ]);
    const row = await parentOf(view, "A");
    expect(row.style.flexDirection).toBe("row");
    expect(row.style.justifyContent).toBe("space-between");
    const item = await parentOf(view, "C");
    expect(item.style.gridColumn).toBe("span 2");
    const grid = item.parentElement!;
    expect(grid.style.gridTemplateColumns).toContain("repeat(auto-fit");
    expect(grid.style.gridTemplateColumns).toContain("/ 3)");
  });

  it("makes a GridItem that spans every column fill the row", async () => {
    const view = renderSurface(ui, [
      { id: "root", component: "Grid", columns: 2, children: ["b"] },
      { id: "b", component: "GridItem", span: 2, children: ["c"] },
      { id: "c", component: "Label", text: "wide" },
    ]);
    expect((await parentOf(view, "wide")).style.gridColumn).toBe("1 / -1");
  });

  it("collapses a Grid with a column count and keeps containers inside their parent", async () => {
    const view = renderSurface(ui, [
      { id: "root", component: "Grid", columns: 2, children: ["a", "b"] },
      { id: "a", component: "Card", children: ["ta"] },
      { id: "ta", component: "Label", text: "Left" },
      { id: "b", component: "Card", children: ["tb"] },
      { id: "tb", component: "Label", text: "Right" },
    ]);
    const card = await parentOf(view, "Left");
    const grid = card.parentElement!;
    expect(grid.style.gridTemplateColumns).toBe(
      "repeat(auto-fit, minmax(min(100%, max(260px, calc((100% - 1 * calc(var(--spacing, 0.25rem) * 4)) / 2))), 1fr))",
    );
    expect(grid.style.gap).toBe(spacing(4));
    for (const element of [grid, card]) {
      expect(element.style.minWidth).toMatch(/^0(px)?$/);
      expect(element.style.maxWidth).toBe("100%");
      expect(element.style.boxSizing).toBe("border-box");
    }
  });

  it("spaces Row children 8px apart unless a gap is given", async () => {
    const view = renderSurface(ui, [
      { id: "root", component: "Column", children: ["r1", "r2"] },
      { id: "r1", component: "Row", children: ["a"] },
      { id: "a", component: "Label", text: "auto" },
      { id: "r2", component: "Row", gap: 0, children: ["b"] },
      { id: "b", component: "Label", text: "none" },
    ]);
    expect((await parentOf(view, "auto")).style.gap).toBe(spacing(2));
    expect((await parentOf(view, "none")).style.gap).toBe(spacing(0));
  });

  it("centers Row children by default and keeps an explicit align", async () => {
    const view = renderSurface(ui, [
      { id: "root", component: "Column", children: ["r1", "r2"] },
      { id: "r1", component: "Row", justify: "between", children: ["k"] },
      { id: "k", component: "Label", text: "Price" },
      { id: "r2", component: "Row", align: "start", children: ["s"] },
      { id: "s", component: "Label", text: "top" },
    ]);
    const row = await parentOf(view, "Price");
    expect(row.style.alignItems).toBe("center");
    expect(row.dataset.a2uiRow).toBe("between");
    expect((await parentOf(view, "top")).style.alignItems).toBe("flex-start");
  });

  it("gives a Card its default padding, radius and border", async () => {
    const view = renderSurface(ui, [
      { id: "root", component: "Card", children: ["t"] },
      { id: "t", component: "Label", text: "inside" },
    ]);
    const card = await parentOf(view, "inside");
    expect(card.style.padding).toBe(spacing(4));
    expect(card.style.borderRadius).toBe("var(--a2ui-radius-xl, 16px)");
    expect(card.style.border).toContain("1px solid");
  });

  it("draws no box for a section Card, and a box for an outline Card in a Card", async () => {
    const view = renderSurface(ui, [
      { id: "root", component: "Column", children: ["s", "p"] },
      { id: "s", component: "Card", variant: "section", children: ["st"] },
      { id: "st", component: "Label", text: "Section" },
      { id: "p", component: "Card", children: ["o"] },
      { id: "o", component: "Card", variant: "outline", children: ["ot"] },
      { id: "ot", component: "Label", text: "Outlined" },
    ]);
    const section = await parentOf(view, "Section");
    expect(section.dataset.a2uiCardVariant).toBe("section");
    expect(section.getAttribute("style")).not.toContain("solid");
    expect(section.style.padding).toBe("0px");
    expect(section.style.gap).toBe(spacing(4));
    const outline = await parentOf(view, "Outlined");
    expect(outline.dataset.a2uiCard).toBe("nested");
    expect(outline.style.border).toContain("1px solid");
  });

  it("keeps the border of a top-level Card and removes it from a nested one", async () => {
    const view = renderSurface(ui, [
      { id: "root", component: "Card", children: ["inner"] },
      { id: "inner", component: "Card", padding: 4, children: ["t"] },
      { id: "t", component: "Label", text: "nested" },
    ]);
    const inner = await parentOf(view, "nested");
    const outer = inner.parentElement!;
    expect(outer.dataset.a2uiCard).toBe("top");
    expect(outer.style.border).toContain("1px solid");
    expect(outer.style.gap).toBe(spacing(4));
    expect(inner.dataset.a2uiCard).toBe("nested");
    expect(inner.getAttribute("style")).not.toMatch(/border:[^;]*solid/);
    expect(inner.style.boxShadow).toBe("none");
    expect(inner.style.padding).toMatch(/^0(px)?$/);
    expect(inner.style.gap).toBe(spacing(3));
  });

  it("turns a nested Card with a background into the inner panel", async () => {
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
    const neutral = await parentOf(view, "neutral");
    expect(neutral.getAttribute("style")).not.toMatch(/border:[^;]*solid/);
    expect(neutral.style.padding).toBe(spacing(3));
    expect(neutral.style.borderRadius).toBe("var(--a2ui-radius-md, 8px)");
    expect(neutral.style.background).toContain("rgb(252, 252, 252)");
    const tinted = await parentOf(view, "tinted");
    expect(tinted.style.background).toContain("rgba(0, 128, 93, 0.06)");
  });

  it("renders a bordered Box as the inner panel in a Card, and with a border outside of one", async () => {
    const view = renderSurface(ui, [
      { id: "root", component: "Column", children: ["card", "plain"] },
      { id: "card", component: "Card", children: ["panel"] },
      { id: "panel", component: "Box", border: true, children: ["t1"] },
      { id: "t1", component: "Label", text: "panel" },
      { id: "plain", component: "Box", border: true, children: ["t2"] },
      { id: "t2", component: "Label", text: "plain" },
    ]);
    const panel = await parentOf(view, "panel");
    expect(panel.getAttribute("style")).not.toMatch(/border:[^;]*solid/);
    expect(panel.style.padding).toBe(spacing(3));
    expect(panel.style.borderRadius).toBe("var(--a2ui-radius-md, 8px)");
    expect(panel.style.background).toContain("rgb(252, 252, 252)");
    expect((await parentOf(view, "plain")).style.border).toContain("1px solid");
  });

  it("uses 16px between the groups in a Card and 8px in a group", async () => {
    const view = renderSurface(ui, [
      { id: "root", component: "Card", children: ["group"] },
      { id: "group", component: "Column", children: ["inner"] },
      { id: "inner", component: "Column", children: ["t"] },
      { id: "t", component: "Label", text: "deep" },
    ]);
    const inner = await parentOf(view, "deep");
    const group = inner.parentElement!;
    expect(group.style.gap).toBe(spacing(4));
    expect(inner.style.gap).toBe(spacing(2));
  });

  it("renders a Divider as a rule and hides a Spacer from screen readers", async () => {
    const view = renderSurface(ui, [
      { id: "root", component: "Column", children: ["d", "s", "t"] },
      { id: "d", component: "Divider", color: "strong" },
      { id: "s", component: "Spacer", minSize: 8 },
      { id: "t", component: "Label", text: "after" },
    ]);
    await view.findByText("after");
    const rule = view.getByRole("separator");
    expect(rule.style.borderTop).toContain("--a2ui-color-border-strong");
    const spacer = view.container.querySelector('[aria-hidden="true"]');
    expect(spacer).toBeInstanceOf(HTMLDivElement);
    expect((spacer as HTMLDivElement).style.minHeight).toBe(spacing(8));
  });

  it("makes a Carousel a focusable scroll region, named by its label", async () => {
    const view = renderSurface(ui, [
      {
        id: "root",
        component: "Carousel",
        label: "Plans",
        children: ["i"],
      },
      { id: "i", component: "CarouselItem", children: ["t"] },
      { id: "t", component: "Label", text: "slide" },
    ]);
    await view.findByText("slide");
    const carousel = view.getByRole("region", { name: "Plans" });
    expect(carousel.tabIndex).toBe(0);
    expect(carousel.getAttribute("aria-roledescription")).toBe("carousel");
    expect(carousel.style.overflowX).toBe("auto");
    expect(carousel.style.scrollSnapType).toBe("x proximity");
  });

  it("makes a scrollable container focusable and leaves others out of the tab order", async () => {
    const view = renderSurface(ui, [
      { id: "root", component: "Column", children: ["s", "p"] },
      { id: "s", component: "Column", scrollable: true, children: ["a"] },
      { id: "a", component: "Label", text: "scrolls" },
      { id: "p", component: "Column", children: ["b"] },
      { id: "b", component: "Label", text: "static" },
    ]);
    const scroller = await parentOf(view, "scrolls");
    expect(scroller.tabIndex).toBe(0);
    expect(scroller.style.overflow).toBe("auto");
    expect((await parentOf(view, "static")).hasAttribute("tabindex")).toBe(
      false,
    );
  });

  it.each(["Column", "Grid", "Card", "Row", "Box", "Carousel", "Flow"])(
    "%s repeats a template child for each data item",
    async (component) => {
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
      const alpha = await view.findByText("Alpha");
      const beta = await view.findByText("Beta");
      expect(alpha.parentElement).toBe(beta.parentElement);
    },
  );

  it("adds a template item to a Column when the list grows", async () => {
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
    await view.findByText("Alpha");
    view.update({
      version: "v1.0",
      updateDataModel: {
        surfaceId: SURFACE_ID,
        path: "/items/1",
        value: { name: "Beta" },
      },
    });
    const column = await parentOf(view, "Beta");
    expect([...column.children].map((child) => child.textContent)).toEqual([
      "Alpha",
      "Beta",
    ]);
  });
});

describe("layoutStyle", () => {
  it("never has an undefined key, so it never resets the gap shorthand", () => {
    const style = layoutStyle({ gap: 4 });
    expect(Object.values(style)).not.toContain(undefined);
    expect("rowGap" in style).toBe(false);
    expect(style.gap).toBe(spacing(4));
  });
});
