import { describe, it, expect, beforeEach } from "vitest";
import { sandboxFunctions, setSandboxSnapshot } from "./sandbox-functions";
import type { Card, ExpensePolicy, Transaction } from "@/app/api/v1/data";
import { CardBrand, ExpenseRole } from "@/app/api/v1/data";

const fn = (name: string) => {
  const f = sandboxFunctions.find((s) => s.name === name);
  if (!f) throw new Error(`no sandbox function named ${name}`);
  return f;
};

const cards: Card[] = [
  {
    id: "c1",
    last4: "4242",
    expiry: "12/29",
    type: CardBrand.Visa,
    color: "bg-blue-500",
    pin: "1234",
    expensePolicyId: "pol-mkt",
  },
];
const policies: ExpensePolicy[] = [
  { id: "pol-mkt", type: ExpenseRole.Marketing, limit: 5000, spent: 500 },
];
const transactions: Transaction[] = [
  {
    id: "t1",
    title: "Google Ads",
    amount: -5000,
    date: "2026-01-01",
    policyId: "pol-mkt",
    cardId: "c1",
    status: "pending",
    activeExceptionId: null,
  },
  {
    id: "t2",
    title: "Lunch",
    amount: -20,
    date: "2026-01-02",
    policyId: "pol-mkt",
    cardId: "c1",
    status: "approved",
    activeExceptionId: null,
  },
];

beforeEach(() => setSandboxSnapshot({ cards, policies, transactions }));

describe("getCards", () => {
  it("never leaks pin or expiry", async () => {
    const out = (await fn("getCards").handler({})) as Record<string, unknown>[];
    expect(out).toHaveLength(1);
    expect(out.every((c) => !("pin" in c))).toBe(true);
    expect(out.every((c) => !("expiry" in c))).toBe(true);
    expect(out[0]).toMatchObject({
      id: "c1",
      last4: "4242",
      type: CardBrand.Visa,
      expensePolicyId: "pol-mkt",
    });
  });
});

describe("getPolicies", () => {
  it("projects policies to id/type/limit/spent", async () => {
    const out = (await fn("getPolicies").handler({})) as Record<
      string,
      unknown
    >[];
    expect(out).toEqual([
      { id: "pol-mkt", type: ExpenseRole.Marketing, limit: 5000, spent: 500 },
    ]);
  });
});

describe("getTransactions", () => {
  it("surfaces the derived overLimit flag", async () => {
    const out = (await fn("getTransactions").handler({})) as Array<{
      id: string;
      overLimit: boolean;
    }>;
    expect(out.find((t) => t.id === "t1")?.overLimit).toBe(true);
    expect(out.find((t) => t.id === "t2")?.overLimit).toBe(false);
  });

  it("honors the status filter", async () => {
    const out = (await fn("getTransactions").handler({
      status: "approved",
    })) as Array<{ id: string }>;
    expect(out.map((t) => t.id)).toEqual(["t2"]);
  });
});

describe("getKpis", () => {
  it("computes counts from the snapshot", async () => {
    const kpis = (await fn("getKpis").handler({})) as {
      totalSpend: number;
      pendingCount: number;
      overLimitCount: number;
      policyCount: number;
    };
    expect(kpis).toEqual({
      totalSpend: 20,
      pendingCount: 1,
      overLimitCount: 1,
      policyCount: 1,
    });
  });
});
