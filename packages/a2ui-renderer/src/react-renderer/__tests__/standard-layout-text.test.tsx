import { describe, expect, it } from "vitest";
import { renderStandard } from "./standard-test-utils";

describe("standard catalog: layout and text", () => {
  it("renders Box with 4px gap and padding, a Title and a Text with inline markdown", async () => {
    const v = renderStandard([
      {
        id: "root",
        component: "Box",
        gap: 2,
        padding: 3,
        border: true,
        radius: "lg",
        children: ["t", "x"],
      },
      { id: "t", component: "Title", text: "Team plan", size: "xl" },
      {
        id: "x",
        component: "Text",
        text: "Was ~~$39~~ now **$29**",
        color: "secondary",
      },
    ]);
    const box = (await v.findByText("Team plan")).parentElement!;
    expect(box.style.gap).toBe("calc(var(--spacing, 0.25rem) * 2)");
    expect(box.style.padding).toBe("calc(var(--spacing, 0.25rem) * 3)");
    expect(v.container.querySelector("s")!.textContent).toBe("$39");
    expect(v.container.querySelector("strong")!.textContent).toBe("$29");
  });
  it("Row lays children out horizontally and Grid uses the column count", async () => {
    const v = renderStandard([
      { id: "root", component: "Column", children: ["r", "g"] },
      { id: "r", component: "Row", justify: "between", children: ["a"] },
      { id: "a", component: "Text", text: "A" },
      { id: "g", component: "Grid", columns: 3, children: ["b"] },
      { id: "b", component: "GridItem", span: 2, children: ["c"] },
      { id: "c", component: "Text", text: "C" },
    ]);
    const row = (await v.findByText("A")).parentElement!;
    expect(row.style.flexDirection).toBe("row");
    expect(row.style.justifyContent).toBe("space-between");
    const grid = (await v.findByText("C")).parentElement!.parentElement!;
    expect(grid.style.gridTemplateColumns).toContain("repeat(auto-fit");
    expect(grid.style.gridTemplateColumns).toContain("/ 3)");
  });
  it("Grid with a numeric column count collapses responsively and containers fit their parent", async () => {
    const v = renderStandard([
      { id: "root", component: "Grid", columns: 2, children: ["a", "b"] },
      { id: "a", component: "Card", children: ["ta"] },
      { id: "ta", component: "Text", text: "Left" },
      { id: "b", component: "Card", children: ["tb"] },
      { id: "tb", component: "Text", text: "Right" },
    ]);
    const card = (await v.findByText("Left")).parentElement!;
    const grid = card.parentElement!;
    expect(grid.style.gridTemplateColumns).toBe(
      "repeat(auto-fit, minmax(min(100%, max(260px, calc((100% - 1 * calc(var(--spacing, 0.25rem) * 4)) / 2))), 1fr))",
    );
    expect(grid.style.gap).toBe("calc(var(--spacing, 0.25rem) * 4)");
    for (const el of [grid, card]) {
      expect(el.style.minWidth).toMatch(/^0(px)?$/);
      expect(el.style.maxWidth).toBe("100%");
      expect(el.style.boxSizing).toBe("border-box");
    }
  });
  it("Row spaces children 8px apart unless a gap is given", async () => {
    const v = renderStandard([
      { id: "root", component: "Column", children: ["r1", "r2"] },
      { id: "r1", component: "Row", children: ["a"] },
      { id: "a", component: "Text", text: "auto" },
      { id: "r2", component: "Row", gap: 0, children: ["b"] },
      { id: "b", component: "Text", text: "none" },
    ]);
    expect((await v.findByText("auto")).parentElement!.style.gap).toBe(
      "calc(var(--spacing, 0.25rem) * 2)",
    );
    expect(v.getByText("none").parentElement!.style.gap).toBe(
      "calc(var(--spacing, 0.25rem) * 0)",
    );
  });
  it("Text binds to the data model", async () => {
    const v = renderStandard(
      [{ id: "root", component: "Text", text: { path: "/price" } }],
      { price: "$290" },
    );
    expect(await v.findByText("$290")).toBeTruthy();
  });
  it("Title maps sizes to heading levels", async () => {
    const v = renderStandard([
      { id: "root", component: "Column", children: ["a", "b", "c", "d"] },
      { id: "a", component: "Title", text: "small", size: "sm" },
      { id: "b", component: "Title", text: "default" },
      { id: "c", component: "Title", text: "large", size: "lg" },
      { id: "d", component: "Title", text: "huge", size: "5xl" },
    ]);
    expect((await v.findByText("small")).tagName).toBe("H4");
    expect(v.getByText("default").tagName).toBe("H3");
    expect(v.getByText("large").tagName).toBe("H2");
    expect(v.getByText("huge").tagName).toBe("H1");
  });
  it("Text renders inline children after its text", async () => {
    const v = renderStandard([
      { id: "root", component: "Text", text: "Plan", children: ["b"] },
      { id: "b", component: "Badge", label: "Pro" },
    ]);
    const badge = await v.findByText("Pro");
    expect(badge.closest("span[data-a2ui-text]")).not.toBeNull();
  });
  it("Badge, Caption, Label, Divider, Spacer, Blockquote, Code, Link, Markdown render", async () => {
    const v = renderStandard([
      {
        id: "root",
        component: "Column",
        children: ["b", "c", "l", "d", "s", "q", "k", "a", "m"],
      },
      { id: "b", component: "Badge", label: "New", color: "success" },
      { id: "c", component: "Caption", text: "cap" },
      { id: "l", component: "Label", text: "lab" },
      { id: "d", component: "Divider" },
      { id: "s", component: "Spacer", minSize: 8 },
      { id: "q", component: "Blockquote", text: "quote" },
      { id: "k", component: "Code", text: "x = 1" },
      {
        id: "a",
        component: "Link",
        text: "docs",
        href: "https://copilotkit.ai",
      },
      { id: "m", component: "Markdown", text: "# H\n\n- one" },
    ]);
    expect(await v.findByText("New")).toBeTruthy();
    expect(v.getByText("quote").closest("blockquote")).not.toBeNull();
    expect(v.getByText("docs").getAttribute("href")).toBe(
      "https://copilotkit.ai",
    );
    expect(v.container.querySelector("h1")!.textContent).toBe("H");
    expect(v.container.querySelector("li")!.textContent).toBe("one");
    expect(v.getByText("x = 1").closest("pre")).not.toBeNull();
    expect(v.container.querySelector("hr")).not.toBeNull();
  });
  it("Link refuses non-http hrefs", async () => {
    const v = renderStandard([
      {
        id: "root",
        component: "Link",
        text: "bad",
        href: "javascript:alert(1)",
      },
    ]);
    expect((await v.findByText("bad")).getAttribute("href")).toBeNull();
  });
  it("Card applies default padding, radius and border", async () => {
    const v = renderStandard([
      { id: "root", component: "Card", children: ["t"] },
      { id: "t", component: "Text", text: "inside" },
    ]);
    const card = (await v.findByText("inside")).parentElement!;
    expect(card.style.padding).toBe("calc(var(--spacing, 0.25rem) * 4)");
    expect(card.style.borderRadius).toBe("var(--a2ui-radius-xl, 16px)");
  });

  it.each(["Column", "Grid", "Card", "Row", "Box", "Carousel", "Flow"])(
    "%s repeats a template child per data item",
    async (component) => {
      const v = renderStandard(
        [
          {
            id: "root",
            component,
            children: { componentId: "row", path: "/items" },
          },
          { id: "row", component: "Text", text: { path: "name" } },
        ],
        { items: [{ name: "Alpha" }, { name: "Beta" }] },
      );
      expect(await v.findByText("Alpha")).toBeTruthy();
      expect(await v.findByText("Beta")).toBeTruthy();
    },
  );
});
