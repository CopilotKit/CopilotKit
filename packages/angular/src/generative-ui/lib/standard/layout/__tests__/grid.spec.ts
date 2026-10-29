import { describe, expect, it } from "vitest";
import { renderSurface } from "../../../__tests__/render";
import { gridItemColumn } from "../index";
import { parentOf, spacing, ui } from "./helpers";

describe("standard layout", () => {
  it("lays a Row out horizontally and gives a Grid its column count", () => {
    const view = renderSurface(ui, [
      { id: "root", component: "Column", children: ["r", "g"] },
      { id: "r", component: "Row", justify: "spaceBetween", children: ["a"] },
      { id: "a", component: "Label", text: "A" },
      { id: "g", component: "Grid", columns: 3, children: ["b"] },
      { id: "b", component: "GridItem", span: 2, children: ["c"] },
      { id: "c", component: "Label", text: "C" },
    ]);
    const row = parentOf(view, "A");
    expect(row.style.flexDirection).toBe("row");
    expect(row.style.justifyContent).toBe("space-between");
    const item = parentOf(view, "C");
    expect(item.style.gridColumn).toBe("span 2");
    const grid = item.parentElement!;
    expect(grid.style.gridTemplateColumns).toContain("repeat(auto-fit");
    expect(grid.style.gridTemplateColumns).toContain("/ 3)");
  });

  it("makes a GridItem that spans every column fill the row", () => {
    const view = renderSurface(ui, [
      { id: "root", component: "Grid", columns: 2, children: ["a", "b", "c"] },
      { id: "a", component: "GridItem", span: 2, children: ["ta"] },
      { id: "ta", component: "Label", text: "wide" },
      { id: "b", component: "GridItem", span: 4, children: ["tb"] },
      { id: "tb", component: "Label", text: "wider" },
      { id: "c", component: "GridItem", span: 1, children: ["tc"] },
      { id: "tc", component: "Label", text: "narrow" },
    ]);
    expect(parentOf(view, "wide").style.gridColumn).toBe("1 / -1");
    // A span past the column count fills the row instead of overflowing.
    expect(parentOf(view, "wider").style.gridColumn).toBe("1 / -1");
    expect(parentOf(view, "narrow").style.gridColumn).toBe("span 1");
  });

  it("collapses a Grid with a column count and keeps containers inside their parent", () => {
    const view = renderSurface(ui, [
      { id: "root", component: "Grid", columns: 2, children: ["a", "b"] },
      { id: "a", component: "Card", children: ["ta"] },
      { id: "ta", component: "Label", text: "Left" },
      { id: "b", component: "Card", children: ["tb"] },
      { id: "tb", component: "Label", text: "Right" },
    ]);
    const card = parentOf(view, "Left");
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
});

describe("layout helpers", () => {
  it("clamps spans that cover every column to the full row", () => {
    expect(gridItemColumn(undefined, 3)).toBeUndefined();
    expect(gridItemColumn(2, 3)).toBe("span 2");
    expect(gridItemColumn(3, 3)).toBe("1 / -1");
    expect(gridItemColumn(5, 2)).toBe("1 / -1");
    expect(gridItemColumn(2, 1)).toBe("1 / -1");
    expect(gridItemColumn(2, undefined)).toBe("span 2");
  });
});
