import { describe, it, expect } from "vitest";
import { recommendProductsTool } from "../recommend.js";
import { crm } from "../../crm/store.js";

describe("recommend_products tool", () => {
  it("resolves an account by name and returns a quote payload shape", async () => {
    const r = (await recommendProductsTool.invoke({
      name: "CopilotKit",
      seats: 30,
      useCase: "studio fleet",
    })) as any;
    expect(typeof r.accountId).toBe("string");
    expect(r.accountId.length).toBeGreaterThan(0);
    expect(typeof r.accountName).toBe("string");
    expect(r.accountName).toBe("CopilotKit");
    expect(typeof r.useCase).toBe("string");
    expect(typeof r.seats).toBe("number");
    expect(Array.isArray(r.lineItems)).toBe(true);
    expect(r.lineItems.length).toBeGreaterThan(0);
    expect(typeof r.subtotal).toBe("number");
    expect(typeof r.note).toBe("string");
    expect(r.note.length).toBeGreaterThan(0);
  });

  it("resolves an account by accountId", async () => {
    const r = (await recommendProductsTool.invoke({
      accountId: "a6",
      seats: 10,
    })) as any;
    expect(r.accountId).toBe("a6");
    expect(r.accountName).toBe("CopilotKit");
  });

  it("each line item has productId, name, category, qty, unitPrice, lineTotal, photoUrl", async () => {
    const r = (await recommendProductsTool.invoke({
      name: "Acme",
      seats: 25,
      useCase: "fleet refresh",
    })) as any;
    for (const li of r.lineItems) {
      expect(typeof li.productId).toBe("string");
      expect(typeof li.name).toBe("string");
      expect(typeof li.category).toBe("string");
      expect(typeof li.qty).toBe("number");
      expect(li.qty).toBeGreaterThan(0);
      expect(typeof li.unitPrice).toBe("number");
      expect(typeof li.lineTotal).toBe("number");
      expect(li.lineTotal).toBe(li.qty * li.unitPrice);
      expect(typeof li.photoUrl).toBe("string");
      // The product must exist in the catalog with matching price/category.
      const product = crm.getProduct(li.productId);
      expect(product).toBeTruthy();
      expect(li.unitPrice).toBe(product!.unitPrice);
      expect(li.category).toBe(product!.category);
    }
  });

  it("lineItems lineTotals sum to subtotal", async () => {
    const r = (await recommendProductsTool.invoke({
      name: "CopilotKit",
      seats: 30,
      useCase: "fleet",
    })) as any;
    const sum = r.lineItems.reduce((s: number, li: any) => s + li.lineTotal, 0);
    expect(r.subtotal).toBe(sum);
  });

  it("a 'fleet' use case includes laptops", async () => {
    const r = (await recommendProductsTool.invoke({
      name: "Soylent",
      seats: 30,
      useCase: "ops laptop fleet",
    })) as any;
    const categories = r.lineItems.map((li: any) => li.category);
    expect(categories).toContain("Laptop");
  });

  it("a heavy/workstation use case includes a Workstation or Server", async () => {
    const r = (await recommendProductsTool.invoke({
      name: "Initech",
      seats: 8,
      useCase: "ML workstation simulation",
    })) as any;
    const categories = r.lineItems.map((li: any) => li.category);
    expect(
      categories.some((c: string) => c === "Workstation" || c === "Server"),
    ).toBe(true);
  });

  it("seats drive laptop quantity for a fleet", async () => {
    const r = (await recommendProductsTool.invoke({
      name: "CopilotKit",
      seats: 12,
      useCase: "laptop fleet",
    })) as any;
    const laptop = r.lineItems.find((li: any) => li.category === "Laptop");
    expect(laptop).toBeTruthy();
    expect(laptop.qty).toBe(12);
  });

  it("throws when the account cannot be resolved", async () => {
    await expect(
      recommendProductsTool.invoke({ name: "Nonexistent Co" }),
    ).rejects.toThrow(/account/i);
  });

  it("does not mutate the deal store (read-only quote)", async () => {
    const before = crm
      .getStateSnapshot()
      .deals.map((d) => ({ id: d.id, amount: d.amount }));
    await recommendProductsTool.invoke({
      name: "CopilotKit",
      seats: 40,
      useCase: "fleet",
    });
    const after = crm
      .getStateSnapshot()
      .deals.map((d) => ({ id: d.id, amount: d.amount }));
    expect(after).toEqual(before);
  });
});
