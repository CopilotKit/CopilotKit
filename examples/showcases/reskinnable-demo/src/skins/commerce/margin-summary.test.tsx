import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SUMMARY_ROW_CAP, selectSummaryRows } from "./margin-summary";
import { MarginSummaryList } from "./tools";
import { SEED_FLOORS, SEED_PRODUCTS } from "./data/seed";
import type { Category, MarginFloor, Product } from "./data/types";
import { productFloorStatus } from "./data/derive";

/**
 * BEAT 4's margin summary used to render `rows.slice(0, 12)` and nothing else.
 * Against the seeded range that withholds two SKUs, and under `byCategory` —
 * where the ranked order is alphabetical by category — the two it withheld were
 * both Outerwear SKUs, one of them below its floor. The list read as complete.
 *
 * These tests pin the three properties that failure violated: the withheld count
 * is stated, no category vanishes unnamed, and below-floor rows still survive the
 * cap under `belowFloorFirst`.
 *
 * No `@testing-library/jest-dom` in this app, so DOM assertions are plain.
 */
const floors = [...SEED_FLOORS] as MarginFloor[];
const products = SEED_PRODUCTS.map((p) => ({ ...p }) as Product);

const categoriesOf = (rows: Product[]) => new Set(rows.map((r) => r.category));
const belowFloor = (rows: Product[]) =>
  rows.filter((r) => productFloorStatus(floors, r) === "below");

afterEach(cleanup);

describe("the seeded range the cap is judged against", () => {
  it("carries more SKUs than the cap, so truncation is real", () => {
    // 14 seeded SKUs against a cap of 12. If someone trims the seed to fit the
    // cap, every assertion below would pass vacuously — so it is asserted.
    expect(products).toHaveLength(14);
    expect(products.length).toBeGreaterThan(SUMMARY_ROW_CAP);
  });

  it("spreads those SKUs over five categories, one of which fits in the tail", () => {
    const perCategory = new Map<Category, number>();
    for (const item of products) {
      perCategory.set(item.category, (perCategory.get(item.category) ?? 0) + 1);
    }
    expect(Object.fromEntries(perCategory)).toEqual({
      Knitwear: 3,
      Outerwear: 2,
      Footwear: 2,
      Home: 3,
      Accessories: 4,
    });
    // Two of them trade under their own category floor.
    expect(belowFloor(products).map((p) => p.name)).toEqual([
      "Harbor Parka",
      "Lark Runner",
    ]);
  });
});

describe("selectSummaryRows", () => {
  it("says nothing when everything fits", () => {
    const selection = selectSummaryRows(products.slice(0, 5), floors, {
      byCategory: true,
      belowFloorFirst: true,
    });
    expect(selection.visible).toHaveLength(5);
    expect(selection.withheld).toBe(0);
    expect(selection.droppedCategories).toEqual([]);
    expect(selection.caption).toBeNull();
  });

  it("states how many rows the cap withheld, out of how many", () => {
    const selection = selectSummaryRows(products, floors, {
      byCategory: false,
      belowFloorFirst: true,
    });
    expect(selection.visible).toHaveLength(SUMMARY_ROW_CAP);
    expect(selection.withheld).toBe(2);
    expect(selection.caption).toContain("2 of 14 SKUs not shown");
  });

  it("names any category that disappeared entirely under byCategory", () => {
    // The regression case exactly: grouped by category, below-floor rows NOT
    // hoisted, so the cap eats the alphabetical tail whole.
    const selection = selectSummaryRows(products, floors, {
      byCategory: true,
      belowFloorFirst: false,
    });
    expect(categoriesOf(selection.visible).has("Outerwear")).toBe(false);
    expect(selection.droppedCategories).toEqual(["Outerwear"]);
    expect(selection.caption).toContain("Nothing from Outerwear appears here");
  });

  it("counts a withheld below-floor row in the caption rather than losing it", () => {
    const selection = selectSummaryRows(products, floors, {
      byCategory: true,
      belowFloorFirst: false,
    });
    // Harbor Parka is below its Outerwear floor and is one of the two withheld.
    expect(belowFloor(selection.visible).map((p) => p.name)).toEqual([
      "Lark Runner",
    ]);
    expect(selection.caption).toContain("1 below floor");
  });

  it("keeps every below-floor row above the cut under belowFloorFirst", () => {
    for (const byCategory of [true, false]) {
      const selection = selectSummaryRows(products, floors, {
        byCategory,
        belowFloorFirst: true,
      });
      expect(
        belowFloor(selection.visible)
          .map((p) => p.name)
          .sort(),
      ).toEqual(["Harbor Parka", "Lark Runner"]);
    }
  });

  it("ranks a SKU with no floor on file with the exceptions, not the clean rows", () => {
    // Drop the Home floor: its three SKUs become "unknown" — unchecked, not
    // cleared — and must sort ahead of every clear row.
    const partialFloors = floors.filter((f) => f.category !== "Home");
    const selection = selectSummaryRows(products, partialFloors, {
      byCategory: true,
      belowFloorFirst: true,
      cap: 5,
    });
    expect(selection.visible.map((p) => p.category)).toEqual([
      "Footwear",
      "Outerwear",
      "Home",
      "Home",
      "Home",
    ]);
    // Every unchecked row therefore SURVIVES the cap, so the caption carries no
    // flag clause — the withheld nine all cleared their floors.
    expect(selection.caption).toBe(
      "9 of 14 SKUs not shown. Nothing from Accessories, Knitwear appears here.",
    );
  });

  it("accounts for unchecked withheld rows separately from below-floor ones", () => {
    const selection = selectSummaryRows(products, [], {
      byCategory: false,
      belowFloorFirst: true,
      cap: 1,
    });
    // No floors at all: nothing is below floor, everything is unchecked.
    expect(selection.caption).toContain("13 not checked");
    expect(selection.caption).not.toContain("below floor");
  });
});

describe("MarginSummaryList", () => {
  const renderList = (
    overrides: Partial<{
      byCategory: boolean;
      belowFloorFirst: boolean;
      asMarginPercent: boolean;
      products: Product[];
    }> = {},
  ) =>
    render(
      <MarginSummaryList
        products={overrides.products ?? products}
        floors={floors}
        byCategory={overrides.byCategory ?? true}
        belowFloorFirst={overrides.belowFloorFirst ?? false}
        asMarginPercent={overrides.asMarginPercent ?? true}
        note="You read these by category."
      />,
    );

  it("renders the withheld count on screen, not just in the selection", () => {
    const { container } = renderList();
    expect(container.querySelectorAll("li")).toHaveLength(SUMMARY_ROW_CAP);
    expect(screen.getByText(/2 of 14 SKUs not shown/).textContent).toContain(
      "Nothing from Outerwear appears here",
    );
  });

  it("renders no caption when the whole range fits", () => {
    renderList({ products: products.slice(0, 4) });
    expect(screen.queryByText(/SKUs not shown/)).toBeNull();
  });

  it("still shows the note it was given", () => {
    renderList();
    expect(screen.getByText("You read these by category.")).toBeTruthy();
  });
});
