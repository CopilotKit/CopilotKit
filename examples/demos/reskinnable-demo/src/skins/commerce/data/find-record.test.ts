import { describe, expect, it } from "vitest";
import { findOrder, findProduct, findReturn } from "./find-record";
import type { Order, Product, ReturnRequest } from "./types";

/**
 * A needle that identifies NOTHING must resolve to nothing.
 *
 * Each finder ends in a substring match, and `"anything".includes("")` is true,
 * so before the guard in `find-record.ts` an empty or whitespace-only needle
 * resolved to `rows[0]` — and `holdOrder` / `notifyCustomer` / `postOrderNote`
 * wrote to whatever record happened to be first. The needle comes from the model
 * out of conversation, so blank is ordinary input, and the consequence is a
 * wrong-record WRITE with a confident receipt naming the wrong customer.
 *
 * `rows[0]` in every fixture below is therefore the row a regression would
 * return: the assertions are `toBeUndefined()`, not "not the row I asked for".
 */

const order = (over: Partial<Order>): Order => ({
  id: "ord-1",
  number: "4471",
  customerName: "Priya Raghavan",
  customerEmail: "priya@example.com",
  channel: "web",
  destination: "Lisbon, PT",
  placedAt: new Date().toISOString(),
  status: "open",
  exception: "fraud-review",
  lines: [{ productId: "bw-1", quantity: 2, unitPrice: 40 }],
  total: 80,
  notes: [],
  ...over,
});

const product = (over: Partial<Product>): Product => ({
  id: "bw-1",
  sku: "BW-CDR-HDY",
  name: "Cedar Hoodie",
  category: "Knitwear",
  listPrice: 120,
  unitCost: 70,
  inventory: 400,
  trailing30Units: 90,
  status: "live",
  vendor: "Cedar Mills",
  ...over,
});

const returnRequest = (over: Partial<ReturnRequest>): ReturnRequest => ({
  id: "ret-1",
  orderId: "ord-1",
  orderNumber: "4471",
  customerName: "Priya Raghavan",
  productId: "bw-1",
  reason: "damaged",
  detail: "Arrived scuffed.",
  requestedAt: new Date().toISOString(),
  status: "requested",
  itemValue: 120,
  refundAmount: null,
  ...over,
});

const ORDERS: Order[] = [
  order({}),
  order({ id: "ord-2", number: "4463", customerName: "Dana Reyes" }),
];

const PRODUCTS: Product[] = [
  product({}),
  product({
    id: "bw-2",
    sku: "BW-ALD-THR",
    name: "Alder Throw",
    category: "Home",
  }),
];

const RETURNS: ReturnRequest[] = [
  returnRequest({}),
  returnRequest({
    id: "ret-2",
    orderId: "ord-2",
    orderNumber: "4463",
    customerName: "Dana Reyes",
  }),
];

/** Everything a model might emit when it has no reference to hand. */
const BLANK = ["", " ", "   ", "\t", "\n ", "#", "##", " # "];

describe("findOrder / findProduct / findReturn — a blank needle matches NOTHING", () => {
  it.each(BLANK)("findOrder(%j) is undefined", (needle) => {
    expect(findOrder(ORDERS, needle)).toBeUndefined();
  });

  it.each(BLANK)("findProduct(%j) is undefined", (needle) => {
    expect(findProduct(PRODUCTS, needle)).toBeUndefined();
  });

  it.each(BLANK)("findReturn(%j) is undefined", (needle) => {
    expect(findReturn(RETURNS, needle)).toBeUndefined();
  });

  it("does not fall back to the first row when a real needle misses", () => {
    expect(findOrder(ORDERS, "9999")).toBeUndefined();
    expect(findProduct(PRODUCTS, "Birch Parka")).toBeUndefined();
    expect(findReturn(RETURNS, "Someone Else")).toBeUndefined();
  });
});

describe("findOrder — the references that must still resolve", () => {
  it("resolves by id, number, #number and padded number", () => {
    expect(findOrder(ORDERS, "ord-2")?.id).toBe("ord-2");
    expect(findOrder(ORDERS, "4463")?.id).toBe("ord-2");
    expect(findOrder(ORDERS, "#4463")?.id).toBe("ord-2");
    expect(findOrder(ORDERS, "  #4463 ")?.id).toBe("ord-2");
  });

  it("resolves by exact customer name, case-insensitively, and by substring", () => {
    expect(findOrder(ORDERS, "Dana Reyes")?.id).toBe("ord-2");
    expect(findOrder(ORDERS, "dana reyes")?.id).toBe("ord-2");
    expect(findOrder(ORDERS, "Dana")?.id).toBe("ord-2");
  });
});

describe("findProduct — the references that must still resolve", () => {
  it("resolves by id, SKU and name", () => {
    expect(findProduct(PRODUCTS, "bw-2")?.id).toBe("bw-2");
    expect(findProduct(PRODUCTS, "bw-ald-thr")?.id).toBe("bw-2");
    expect(findProduct(PRODUCTS, "Alder Throw")?.id).toBe("bw-2");
    expect(findProduct(PRODUCTS, " alder ")?.id).toBe("bw-2");
  });
});

describe("findReturn — the references that must still resolve", () => {
  it("resolves by id, customer name and order number", () => {
    expect(findReturn(RETURNS, "ret-2")?.id).toBe("ret-2");
    expect(findReturn(RETURNS, "Dana Reyes")?.id).toBe("ret-2");
    expect(findReturn(RETURNS, "#4463")?.id).toBe("ret-2");
    expect(findReturn(RETURNS, "Dana")?.id).toBe("ret-2");
  });
});
