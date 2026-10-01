// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import * as store from "./store";
import { LedgerError } from "./store";
import { agentReport } from "./agent-view";

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof LedgerError ? e.code : String(e);
  }
  return "OK";
};

describe("the Ledgerline seed", () => {
  beforeEach(() => store.reset());

  it("has about forty reports, with the hero EXP-2291 held by POL-114", () => {
    const all = store.listReports();
    expect(all.length).toBeGreaterThanOrEqual(38);
    expect(all.length).toBeLessThanOrEqual(42);
    const hero = store.getReport("EXP-2291");
    expect(hero.employeeName).toBe("Priya Raman");
    expect(hero.total).toBe(4860);
    expect(hero.category).toBe("Team event");
    expect(hero.status).toBe("submitted");
    expect(hero.holds).toEqual([
      expect.objectContaining({ code: "POL-114", status: "open" }),
    ]);
  });

  it("holds only team events over $2,500 on a department cost center", () => {
    const held = store
      .listReports()
      .filter((r) => r.holds.some((h) => h.status === "open"));
    expect(held.map((r) => r.id).sort()).toEqual(["EXP-2291", "EXP-2317"]);
  });
});

describe("the approve gate", () => {
  beforeEach(() => store.reset());

  it("refuses EXP-2291 with POLICY_HOLD POL-114, naming the code and not the fix", () => {
    let err: LedgerError | undefined;
    try {
      store.approveReport("EXP-2291");
    } catch (e) {
      err = e as LedgerError;
    }
    expect(err?.code).toBe("POLICY_HOLD");
    expect(err?.detail).toEqual({ code: "POL-114" });
    expect(err?.message).not.toMatch(/cost center|CC-410|allocate/i);
  });

  it("stays shut after a note, a non-events cost center, or a retry", () => {
    store.addNote("EXP-2291", "Business purpose: quarterly planning offsite.");
    expect(code(() => store.approveReport("EXP-2291"))).toBe("POLICY_HOLD");
    store.allocateCostCenter("EXP-2291", "CC-100");
    expect(code(() => store.approveReport("EXP-2291"))).toBe("POLICY_HOLD");
  });

  it("opens once an events cost center is allocated, then reimburses", () => {
    const allocated = store.allocateCostCenter("EXP-2291", "cc-410");
    expect(allocated.costCenterId).toBe("CC-410");
    expect(allocated.holds[0]?.status).toBe("resolved");
    expect(store.approveReport("EXP-2291").status).toBe("approved");
    const paid = store.reimburseReport("EXP-2291");
    expect(paid.status).toBe("reimbursed");
    expect(paid.reimbursement?.method).toBe("ACH");
  });

  it("will not reimburse before approval, nor allocate to an unknown cost center", () => {
    expect(code(() => store.reimburseReport("EXP-2291"))).toBe("NOT_APPROVED");
    expect(code(() => store.allocateCostCenter("EXP-2291", "CC-999"))).toBe(
      "UNKNOWN_COST_CENTER",
    );
  });
});

describe("what the agent can read", () => {
  beforeEach(() => store.reset());

  it("never carries the Policy panel's explanation", () => {
    const seen = JSON.stringify([
      agentReport(store.getReport("EXP-2291")),
      store.searchPolicies("POL-114"),
      store.searchPolicies("team event"),
      store.searchPolicies("cost center hold approval"),
    ]);
    expect(seen).not.toMatch(/events cost center|CC-410|must be allocated/i);
  });
});
