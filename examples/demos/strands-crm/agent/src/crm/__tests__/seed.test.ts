import { describe, it, expect } from "vitest";
import { seed } from "../seed.js";
import { isValidStage } from "../types.js";

const CATEGORIES = ["Laptop", "Workstation", "Server", "Display", "Accessory"];

describe("seed", () => {
  it("produces a referentially-consistent dataset", () => {
    const { accounts, contacts, deals, activities, products, salespeople } =
      seed();
    expect(accounts.length).toBeGreaterThanOrEqual(5);
    expect(deals.length).toBeGreaterThanOrEqual(6);

    const acctIds = new Set(accounts.map((a) => a.id));
    const productIds = new Set(products.map((p) => p.id));
    const repIds = new Set(salespeople.map((s) => s.id));
    for (const d of deals) {
      expect(acctIds.has(d.accountId)).toBe(true);
      expect(isValidStage(d.stage)).toBe(true);
      expect(d.probability).toBeGreaterThanOrEqual(0);
      expect(d.probability).toBeLessThanOrEqual(100);
      // Each deal references a real owner and only real products.
      expect(repIds.has(d.ownerId)).toBe(true);
      for (const item of d.lineItems)
        expect(productIds.has(item.productId)).toBe(true);
    }
    const dealIds = new Set(deals.map((d) => d.id));
    for (const c of contacts) expect(acctIds.has(c.accountId)).toBe(true);
    for (const a of activities) expect(dealIds.has(a.dealId)).toBe(true);
  });

  it("every deal amount equals the sum of its line items (qty × unitPrice)", () => {
    const { deals } = seed();
    for (const d of deals) {
      const sum = d.lineItems.reduce((s, it) => s + it.qty * it.unitPrice, 0);
      expect(sum).toBe(d.amount);
    }
  });

  it("line item unit prices match the catalog price for that product", () => {
    const { deals, products } = seed();
    const priceById = new Map(products.map((p) => [p.id, p.unitPrice]));
    for (const d of deals) {
      for (const it of d.lineItems) {
        expect(it.unitPrice).toBe(priceById.get(it.productId));
      }
    }
  });

  it("catalog covers all five product categories", () => {
    const { products } = seed();
    expect(products.length).toBeGreaterThanOrEqual(10);
    for (const cat of CATEGORIES) {
      expect(products.some((p) => p.category === cat)).toBe(true);
    }
  });

  it("includes Nathan Brooks as an AE and at least one Manager", () => {
    const { salespeople } = seed();
    expect(salespeople.length).toBeGreaterThanOrEqual(5);
    const nathan = salespeople.find((s) => s.name === "Nathan Brooks");
    expect(nathan?.role).toBe("AE");
    expect(salespeople.some((s) => s.role === "Manager")).toBe(true);
  });

  it("seeds exactly one prior weekly report with metrics + highlights", () => {
    const { reports } = seed();
    expect(reports).toHaveLength(1);
    const r = reports[0];
    expect(r.title.length).toBeGreaterThan(0);
    expect(r.highlights.length).toBeGreaterThan(0);
    expect(typeof r.metrics.bookings).toBe("number");
    expect(Array.isArray(r.metrics.byStage)).toBe(true);
    expect(Array.isArray(r.metrics.leaderboard)).toBe(true);
  });

  it("includes Closed Won deals across more than one rep and month", () => {
    const { deals } = seed();
    const won = deals.filter((d) => d.stage === "Closed Won");
    expect(won.length).toBeGreaterThanOrEqual(3);
    expect(new Set(won.map((d) => d.ownerId)).size).toBeGreaterThanOrEqual(2);
    expect(
      new Set(won.map((d) => d.closeDate.slice(0, 7))).size,
    ).toBeGreaterThanOrEqual(3);
  });

  it("keeps CopilotKit as account a6", () => {
    const { accounts } = seed();
    expect(accounts.find((a) => a.id === "a6")?.name).toBe("CopilotKit");
  });

  it("returns fresh objects each call (no shared mutation)", () => {
    const a = seed();
    a.deals[0].amount = -1;
    const b = seed();
    expect(b.deals[0].amount).not.toBe(-1);
  });
});
