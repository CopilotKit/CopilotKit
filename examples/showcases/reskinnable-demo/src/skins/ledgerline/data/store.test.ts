// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import * as store from "./store";
import { LedgerError } from "./store";
import { agentCostCenters, agentReport } from "./agent-view";

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
    expect(err?.message).toMatch(/allocation required/);
    expect(err?.message).not.toMatch(/cost center|CC-410|events/i);
  });

  const lines = (ids: Record<string, string>) =>
    Object.entries(ids).map(([lineId, costCenterId]) => ({
      lineId,
      costCenterId,
    }));

  it("stays shut after a note, a wrong cost center, or recoding every line", () => {
    store.addNote("EXP-2291", "Business purpose: quarterly planning offsite.");
    expect(code(() => store.approveReport("EXP-2291"))).toBe("POLICY_HOLD");
    // The decoy: an events-sounding cost center on a marketing budget.
    const decoy = store.recodeLines(
      "EXP-2291",
      lines({ "L2291-1": "CC-430", "L2291-2": "CC-430" }),
    );
    expect(decoy.check).toMatchObject({ status: "open" });
    expect(decoy.check.reason).toMatch(/marketing budget/);
    expect(code(() => store.approveReport("EXP-2291"))).toBe("POLICY_HOLD");
    // Every line to the events budget: transport and supplies are not event spend.
    const all = store.recodeLines(
      "EXP-2291",
      lines({
        "L2291-1": "CC-410",
        "L2291-2": "CC-410",
        "L2291-3": "CC-410",
        "L2291-4": "CC-410",
      }),
    );
    expect(all.check.status).toBe("open");
    expect(all.check.reason).toMatch(/not event spend/);
    expect(code(() => store.approveReport("EXP-2291"))).toBe("POLICY_HOLD");
  });

  it("opens once only the event lines sit on the events budget, then reimburses", () => {
    const { report, check } = store.recodeLines(
      "EXP-2291",
      lines({ "l2291-1": "cc-410", "L2291-2": "CC-410" }),
    );
    expect(check).toEqual({ code: "POL-114", status: "resolved" });
    expect(report.lines.map((l) => l.costCenterId)).toEqual([
      "CC-410",
      "CC-410",
      "CC-200",
      "CC-200",
    ]);
    expect(report.holds[0]?.status).toBe("resolved");
    expect(store.approveReport("EXP-2291").status).toBe("approved");
    const paid = store.reimburseReport("EXP-2291");
    expect(paid.status).toBe("reimbursed");
    expect(paid.reimbursement?.method).toBe("ACH");
  });

  it("reopens the hold when a later recode breaks the rule", () => {
    store.recodeLines(
      "EXP-2291",
      lines({ "L2291-1": "CC-410", "L2291-2": "CC-410" }),
    );
    const back = store.recodeLines("EXP-2291", lines({ "L2291-2": "CC-200" }));
    expect(back.report.holds[0]?.status).toBe("open");
  });

  it("will not reimburse before approval, nor recode to an unknown cost center or line", () => {
    expect(code(() => store.reimburseReport("EXP-2291"))).toBe("NOT_APPROVED");
    expect(
      code(() => store.recodeLines("EXP-2291", lines({ "L2291-1": "CC-999" }))),
    ).toBe("UNKNOWN_COST_CENTER");
    expect(
      code(() => store.recodeLines("EXP-2291", lines({ "L9-9": "CC-410" }))),
    ).toBe("NOT_FOUND");
  });
});

describe("what the agent can read", () => {
  beforeEach(() => store.reset());

  it("never carries the Policy panel's explanation", () => {
    const seen = JSON.stringify([
      agentReport(store.getReport("EXP-2291")),
      agentCostCenters(),
      store.searchPolicies("POL-114"),
      store.searchPolicies("events budget").results,
      store.searchPolicies("team event"),
      store.searchPolicies("cost center hold approval"),
    ]);
    expect(seen).not.toMatch(
      /events budget|events cost center|must be coded|must be allocated|budgetType|eventCost/i,
    );
  });
});
