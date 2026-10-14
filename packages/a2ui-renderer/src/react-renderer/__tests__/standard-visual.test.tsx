import { describe, expect, it } from "vitest";
import { renderStandard } from "./standard-test-utils";
import {
  backgroundColor,
  panelBackground,
  textColor,
} from "../a2ui-react/catalog/standard/tokens";
import { STANDARD_CSS } from "../a2ui-react/catalog/standard/styles";

describe("standard catalog: ChatGPT-like visual treatment", () => {
  it("keeps the border on a top-level Card and flattens a nested one", async () => {
    const v = renderStandard([
      { id: "root", component: "Card", children: ["inner"] },
      { id: "inner", component: "Card", padding: 4, children: ["t"] },
      { id: "t", component: "Text", text: "nested" },
    ]);
    const inner = (await v.findByText("nested")).parentElement!;
    const outer = inner.parentElement!;
    expect(outer.dataset.a2uiCard).toBe("top");
    expect(outer.style.border).toContain("1px solid");
    expect(outer.style.borderRadius).toBe("var(--a2ui-radius-xl, 16px)");
    expect(outer.style.gap).toBe("calc(var(--spacing, 0.25rem) * 4)");
    expect(inner.dataset.a2uiCard).toBe("nested");
    expect(inner.getAttribute("style")).not.toMatch(/border:[^;]*solid/);
    expect(inner.style.boxShadow).toBe("none");
    expect(inner.style.padding).toMatch(/^0(px)?$/);
    expect(inner.style.gap).toBe("calc(var(--spacing, 0.25rem) * 3)");
  });

  it("turns a nested Card with a background into the inner panel", async () => {
    const v = renderStandard([
      { id: "root", component: "Card", children: ["a", "b"] },
      {
        id: "a",
        component: "Card",
        background: "surface-secondary",
        children: ["ta"],
      },
      { id: "ta", component: "Text", text: "neutral" },
      { id: "b", component: "Card", background: "success", children: ["tb"] },
      { id: "tb", component: "Text", text: "tinted" },
    ]);
    const neutral = (await v.findByText("neutral")).parentElement!;
    expect(neutral.getAttribute("style")).not.toMatch(/border:[^;]*solid/);
    expect(neutral.style.padding).toBe("calc(var(--spacing, 0.25rem) * 3)");
    expect(neutral.style.borderRadius).toBe("var(--a2ui-radius-md, 8px)");
    expect(neutral.style.background).toContain("rgb(252, 252, 252)");
    const tinted = (await v.findByText("tinted")).parentElement!;
    expect(tinted.style.background).toContain("rgba(0, 128, 93, 0.06)");
  });

  it("renders a bordered Box inside a Card as the inner panel", async () => {
    const v = renderStandard([
      { id: "root", component: "Card", children: ["box"] },
      { id: "box", component: "Box", border: true, children: ["t"] },
      { id: "t", component: "Text", text: "panel" },
    ]);
    const box = (await v.findByText("panel")).parentElement!;
    expect(box.getAttribute("style")).not.toMatch(/border:[^;]*solid/);
    expect(box.style.padding).toBe("calc(var(--spacing, 0.25rem) * 3)");
    expect(box.style.borderRadius).toBe("var(--a2ui-radius-md, 8px)");
    expect(box.style.background).toContain("rgb(252, 252, 252)");
  });

  it("keeps a bordered Box outside any Card bordered", async () => {
    const v = renderStandard([
      { id: "root", component: "Box", border: true, children: ["t"] },
      { id: "t", component: "Text", text: "plain" },
    ]);
    const box = (await v.findByText("plain")).parentElement!;
    expect(box.style.border).toContain("1px solid");
  });

  it("centres Row children by default and keeps text from stretching", async () => {
    const v = renderStandard([
      { id: "root", component: "Column", children: ["r1", "r2"] },
      {
        id: "r1",
        component: "Row",
        justify: "between",
        children: ["k", "val"],
      },
      { id: "k", component: "Text", text: "Price" },
      { id: "val", component: "Text", text: "$29.00", tabularNums: true },
      { id: "r2", component: "Row", align: "start", children: ["s"] },
      { id: "s", component: "Text", text: "top" },
    ]);
    const value = await v.findByText("$29.00");
    const row = value.parentElement!;
    expect(row.style.alignItems).toBe("center");
    expect(row.dataset.a2uiRow).toBe("between");
    expect(value.style.flex).toBe("0 1 auto");
    expect(value.style.minWidth).toMatch(/^0(px)?$/);
    expect(value.style.width).toBe("");
    expect(value.style.fontVariantNumeric).toBe("tabular-nums");
    expect((await v.findByText("top")).parentElement!.style.alignItems).toBe(
      "flex-start",
    );
    expect(STANDARD_CSS).toContain(
      '[data-a2ui-row="between"]>[data-a2ui-text]:last-child:not(:first-child){text-align:right',
    );
  });

  it("maps background and text tokens to ChatGPT-like values", () => {
    expect(backgroundColor("surface")).toContain("#fff");
    expect(backgroundColor("surface-secondary")).toContain("#f7f7f8");
    expect(backgroundColor("surface-soft")).toContain("#fcfcfc");
    expect(backgroundColor("surface-tertiary")).toContain("#ececec");
    expect(backgroundColor("info")).toContain("rgba(0, 104, 188, 0.08)");
    expect(backgroundColor("success-solid")).toContain("#00805d");
    expect(panelBackground("surface-soft")).toContain("rgb(252, 252, 252)");
    expect(panelBackground("danger")).toBe(
      "var(--a2ui-color-danger-soft, rgba(193, 50, 44, 0.06))",
    );
    expect(textColor("default")).toContain("#0d0d0d");
    expect(textColor("secondary")).toContain("#5d5d5d");
    expect(textColor("tertiary")).toContain("#8e8e8e");
  });
});
