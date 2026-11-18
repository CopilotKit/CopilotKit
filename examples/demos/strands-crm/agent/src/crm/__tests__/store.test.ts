import { describe, it, expect, beforeEach } from "vitest";
import { CrmStore } from "../store.js";
import { initDb } from "../db.js";

let store: CrmStore;
beforeEach(() => {
  store = new CrmStore(initDb(":memory:"));
});

describe("CrmStore", () => {
  it("getStateSnapshot returns all collections", () => {
    const s = store.getStateSnapshot();
    expect(s.deals.length).toBeGreaterThan(0);
    expect(s.accounts.length).toBeGreaterThan(0);
  });

  it("moveStage updates the stage", () => {
    const updated = store.moveStage("d3", "Qualified");
    expect(updated.stage).toBe("Qualified");
    expect(store.getDeal("d3")!.stage).toBe("Qualified");
  });

  it("moveStage rejects an invalid stage", () => {
    expect(() => store.moveStage("d3", "Nope" as never)).toThrow(
      /invalid stage/i,
    );
  });

  it("moveStage rejects an unknown deal", () => {
    expect(() => store.moveStage("zzz", "Lead")).toThrow(/deal not found/i);
  });

  it("updateDeal patches allowed fields only", () => {
    const updated = store.updateDeal("d1", { amount: 50000, probability: 55 });
    expect(updated.amount).toBe(50000);
    expect(updated.probability).toBe(55);
  });

  it("markWon sets Closed Won at 100%", () => {
    const d = store.markWon("d1");
    expect(d.stage).toBe("Closed Won");
    expect(d.probability).toBe(100);
  });

  it("findAccountByName is case-insensitive and fuzzy", () => {
    expect(store.findAccountByName("acme")!.id).toBe("a1");
    expect(store.findAccountByName("ACME CORP")!.id).toBe("a1");
  });

  it("setEnrichment attaches enrichment to the account", () => {
    const enr = {
      summary: "x",
      recentNews: [],
      talkingPoints: [],
      sources: [],
      enrichedAt: "t",
    };
    store.setEnrichment("a1", enr);
    expect(store.getAccount("a1")!.enrichment!.summary).toBe("x");
  });

  it("logActivity appends and returns the activity", () => {
    const before = store.getStateSnapshot().activities.length;
    const a = store.logActivity("d1", "note", "hello");
    expect(a.dealId).toBe("d1");
    expect(store.getStateSnapshot().activities.length).toBe(before + 1);
  });

  it("snapshot is a deep copy (no external mutation)", () => {
    const s = store.getStateSnapshot();
    s.deals[0].amount = -999;
    expect(store.getStateSnapshot().deals[0].amount).not.toBe(-999);
  });

  it("getStateSnapshot includes products, salespeople, and reports", () => {
    const s = store.getStateSnapshot();
    expect(s.products.length).toBeGreaterThan(0);
    expect(s.salespeople.length).toBeGreaterThan(0);
    expect(s.reports.length).toBe(1);
  });

  it("deals carry ownerId and line items", () => {
    const d1 = store.getDeal("d1")!;
    expect(d1.ownerId.length).toBeGreaterThan(0);
    expect(Array.isArray(d1.lineItems)).toBe(true);
    expect(d1.lineItems.length).toBeGreaterThan(0);
  });

  it("listProducts / getProduct map rows to domain objects", () => {
    const products = store.listProducts();
    expect(products.length).toBeGreaterThanOrEqual(10);
    const p1 = store.getProduct("p1")!;
    expect(p1.id).toBe("p1");
    expect(typeof p1.unitPrice).toBe("number");
    expect(p1.category).toBeDefined();
    expect(store.getProduct("nope")).toBeUndefined();
  });

  it("listSalespeople / getSalesperson / findSalespersonByName work", () => {
    expect(store.listSalespeople().length).toBeGreaterThanOrEqual(5);
    const nathan = store.findSalespersonByName("nathan")!;
    expect(nathan.name).toBe("Nathan Brooks");
    expect(store.getSalesperson(nathan.id)!.id).toBe(nathan.id);
    expect(store.findSalespersonByName("Nobody Here")).toBeUndefined();
  });

  it("listReports returns the seeded report (newest first)", () => {
    const reports = store.listReports();
    expect(reports.length).toBe(1);
    expect(reports[0].id).toBe("r1");
    expect(reports[0].metrics).toBeDefined();
    expect(reports[0].highlights.length).toBeGreaterThan(0);
  });

  it("addReport persists a new report at the top of the list", () => {
    store.addReport({
      id: "r2",
      title: "Weekly Sales Report — Jun 1–7, 2026",
      periodStart: "2026-06-01",
      periodEnd: "2026-06-07",
      generatedAt: "2026-06-08T13:00:00.000Z",
      summary: "Test report.",
      highlights: ["a", "b"],
      metrics: {
        bookings: 0,
        weightedForecast: 0,
        winRate: null,
        dealsWon: 0,
        dealsOpen: 0,
        byStage: [],
        byCategory: [],
        leaderboard: [],
      },
    });
    const reports = store.listReports();
    expect(reports.length).toBe(2);
    expect(reports[0].id).toBe("r2"); // newest generatedAt first
  });

  it("setDealLineItems replaces items and recomputes amount", () => {
    const p1 = store.getProduct("p1")!;
    const updated = store.setDealLineItems("d3", [
      { productId: "p1", qty: 3, unitPrice: p1.unitPrice },
    ]);
    expect(updated.amount).toBe(3 * p1.unitPrice);
    expect(updated.lineItems).toHaveLength(1);
    expect(store.getDeal("d3")!.amount).toBe(3 * p1.unitPrice);
  });

  it("setDealLineItems rejects an unknown deal", () => {
    expect(() => store.setDealLineItems("zzz", [])).toThrow(/deal not found/i);
  });
});
