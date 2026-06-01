import { describe, it, expect } from "vitest";
import { queryDataImpl } from "../query-data";

describe("queryDataImpl", () => {
  it("returns an array", () => {
    expect(Array.isArray(queryDataImpl("test"))).toBe(true);
  });

  it("returns 66 rows (11 categories x 6 months)", () => {
    expect(queryDataImpl("test")).toHaveLength(66);
  });

  it("rows have expected columns", () => {
    const row = queryDataImpl("test")[0];
    expect(row).toHaveProperty("date");
    expect(row).toHaveProperty("category");
    expect(row).toHaveProperty("subcategory");
    expect(row).toHaveProperty("amount");
    expect(row).toHaveProperty("type");
    expect(row).toHaveProperty("notes");
  });

  it("returns same data regardless of query", () => {
    const r1 = queryDataImpl("revenue");
    const r2 = queryDataImpl("expenses");
    expect(r1).toEqual(r2);
  });

  it("is deterministic (seeded RNG)", () => {
    const r1 = queryDataImpl("test");
    const r2 = queryDataImpl("test");
    expect(r1).toEqual(r2);
  });

  it("categories are Revenue or Expenses", () => {
    const rows = queryDataImpl("test");
    const categories = new Set(rows.map((r) => r.category));
    expect(categories).toEqual(new Set(["Revenue", "Expenses"]));
  });

  it("types are income or expense", () => {
    const rows = queryDataImpl("test");
    const types = new Set(rows.map((r) => r.type));
    expect(types).toEqual(new Set(["income", "expense"]));
  });

  it("dates are in 2026", () => {
    const rows = queryDataImpl("test");
    for (const row of rows) {
      expect(row.date).toMatch(/^2026-/);
    }
  });

  it("amount is a numeric string", () => {
    const rows = queryDataImpl("test");
    for (const row of rows) {
      expect(Number(row.amount)).not.toBeNaN();
      expect(Number(row.amount)).toBeGreaterThan(0);
    }
  });
});
