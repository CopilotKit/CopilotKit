import { describe, it, expect } from "vitest";
import { CrmStore } from "../store.js";
import { initDb } from "../db.js";
import { buildDealBrief } from "../brief.js";

describe("buildDealBrief", () => {
  it("assembles account, contact, last activity, risk and next step", () => {
    const store = new CrmStore(initDb(":memory:"));
    const brief = buildDealBrief(store, "d4"); // Umbrella, Negotiation, 75%
    expect(brief.accountName).toBe("Umbrella Health");
    expect(brief.stage).toBe("Negotiation");
    expect(brief.keyContact?.name).toBe("Morgan Hsu");
    expect(brief.lastActivity?.type).toBe("meeting");
    expect(["low", "medium", "high"]).toContain(brief.risk);
    expect(brief.nextStep.length).toBeGreaterThan(0);
  });

  it("treats a closed-won deal as low risk (not high from a past close date)", () => {
    const brief = buildDealBrief(new CrmStore(initDb(":memory:")), "d6"); // Globex — Expansion, Closed Won, past close date
    expect(brief.stage).toBe("Closed Won");
    expect(brief.risk).toBe("low");
  });

  it("throws for an unknown deal", () => {
    expect(() =>
      buildDealBrief(new CrmStore(initDb(":memory:")), "zzz"),
    ).toThrow(/deal not found/i);
  });
});
