import { describe, it, expect, beforeEach } from "vitest";
import { CrmStore } from "../store.js";
import { initDb } from "../db.js";

let store: CrmStore;
beforeEach(() => {
  store = new CrmStore(initDb(":memory:"));
});

const sampleItems = [
  {
    productId: "p1",
    name: "Northstar Pro 14",
    category: "Laptop" as const,
    qty: 30,
    unitPrice: 1800,
    lineTotal: 54000,
    photoUrl: "x",
  },
  {
    productId: "p10",
    name: "Northstar Dock Pro",
    category: "Accessory" as const,
    qty: 30,
    unitPrice: 300,
    lineTotal: 9000,
    photoUrl: "y",
  },
];

describe("CrmStore quotes", () => {
  it("starts with no quotes", () => {
    expect(store.listQuotes()).toEqual([]);
    expect(store.getStateSnapshot().quotes).toEqual([]);
  });

  it("addQuote persists a quote, assigns id + createdAt + status, and returns it", () => {
    const q = store.addQuote({
      accountId: "a6",
      accountName: "CopilotKit",
      useCase: "fleet",
      seats: 30,
      lineItems: sampleItems,
      subtotal: 63000,
      note: "Recommended fleet",
    });
    expect(q.id).toMatch(/^q\d+$/);
    expect(q.status).toBe("approved");
    expect(typeof q.createdAt).toBe("string");
    expect(q.subtotal).toBe(63000);
    expect(q.lineItems).toHaveLength(2);
    expect(store.listQuotes()).toHaveLength(1);
    expect(store.getStateSnapshot().quotes[0].id).toBe(q.id);
  });

  it("getQuote returns a stored quote by id, undefined otherwise", () => {
    const q = store.addQuote({
      accountId: "a6",
      accountName: "CopilotKit",
      lineItems: sampleItems,
      subtotal: 63000,
    });
    expect(store.getQuote(q.id)!.accountName).toBe("CopilotKit");
    expect(store.getQuote("nope")).toBeUndefined();
  });

  it("assigns unique incrementing ids across adds", () => {
    const q1 = store.addQuote({
      accountId: "a1",
      accountName: "Acme",
      lineItems: [],
      subtotal: 0,
    });
    const q2 = store.addQuote({
      accountId: "a2",
      accountName: "Globex",
      lineItems: [],
      subtotal: 0,
    });
    expect(q1.id).not.toBe(q2.id);
    expect(store.listQuotes()).toHaveLength(2);
  });
});
