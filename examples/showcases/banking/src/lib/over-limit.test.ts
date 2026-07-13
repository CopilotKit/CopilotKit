import { describe, it, expect } from "vitest";
import { isOverLimit, withOverLimit } from "./over-limit";
import {
  ExpenseRole,
  type ExpensePolicy,
  type Transaction,
} from "@/app/api/v1/data";

const policies: ExpensePolicy[] = [
  { id: "pol-mkt", type: ExpenseRole.Marketing, limit: 5000, spent: 500 },
  { id: "pol-eng", type: ExpenseRole.Engineering, limit: 15000, spent: 1500 },
];

const base: Omit<
  Transaction,
  "id" | "amount" | "policyId" | "activeExceptionId"
> = {
  title: "x",
  date: "2026-01-01",
  cardId: "c1",
  status: "pending",
};

describe("isOverLimit", () => {
  it("is true when spent + |amount| exceeds the limit and there is no active exception", () => {
    const t: Transaction = {
      ...base,
      id: "t1",
      amount: -5000,
      policyId: "pol-mkt",
      activeExceptionId: null,
    };
    expect(isOverLimit(t, policies)).toBe(true);
  });

  it("is false once an exception is active, even if it exceeds the limit", () => {
    const t: Transaction = {
      ...base,
      id: "t2",
      amount: -5000,
      policyId: "pol-mkt",
      activeExceptionId: "ex-1",
    };
    expect(isOverLimit(t, policies)).toBe(false);
  });

  it("is false within the limit", () => {
    const t: Transaction = {
      ...base,
      id: "t3",
      amount: -100,
      policyId: "pol-mkt",
      activeExceptionId: null,
    };
    expect(isOverLimit(t, policies)).toBe(false);
  });

  it("is false when no matching policy exists", () => {
    const t: Transaction = {
      ...base,
      id: "t4",
      amount: -999999,
      policyId: "pol-missing",
      activeExceptionId: null,
    };
    expect(isOverLimit(t, policies)).toBe(false);
  });
});

describe("withOverLimit", () => {
  it("attaches the derived overLimit flag to every transaction", () => {
    const txs: Transaction[] = [
      {
        ...base,
        id: "t1",
        amount: -5000,
        policyId: "pol-mkt",
        activeExceptionId: null,
      },
      {
        ...base,
        id: "t3",
        amount: -100,
        policyId: "pol-mkt",
        activeExceptionId: null,
      },
    ];
    const out = withOverLimit(txs, policies);
    expect(out.map((t) => t.overLimit)).toEqual([true, false]);
    expect(out[0]).toMatchObject({ id: "t1", overLimit: true });
  });
});
