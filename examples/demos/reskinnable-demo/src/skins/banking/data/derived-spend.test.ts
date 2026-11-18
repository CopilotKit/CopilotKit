import { describe, expect, it } from "vitest";

import * as store from "@/skins/banking/data/store";
import { isOverLimit } from "@/skins/banking/data/over-limit";

/**
 * Invariants of the single-ledger model.
 *
 * These lock in the property that made the report trustworthy: every spend
 * figure on every surface is a projection of ONE transaction list. Before this,
 * the report's KPI summed static `policies[].spent` ($137,000) while its charts
 * read the transactions ($30,089), and the two drifted silently.
 */
describe("policies[].spent is derived from the ledger", () => {
  it("equals the sum of APPROVED charges against each policy", () => {
    const txs = store.transactions();
    for (const p of store.policies()) {
      const expected = txs
        .filter((t) => t.status === "approved" && t.policyId === p.id)
        .reduce((sum, t) => sum + Math.abs(t.amount), 0);
      expect(p.spent).toBeCloseTo(expected, 2);
    }
  });

  // Pending spend must stay OUT of `spent`: isOverLimit asks "would approving
  // this charge breach the limit?", which double-counts if the charge is already
  // inside the figure it is being compared against.
  it("excludes pending and flagged charges", () => {
    const notApproved = store
      .transactions()
      .filter((t) => t.status !== "approved");
    expect(notApproved.length).toBeGreaterThan(0);

    const derived = store.policies().reduce((sum, p) => sum + p.spent, 0);
    const everything = store
      .transactions()
      .reduce((sum, t) => sum + Math.abs(t.amount), 0);
    expect(derived).toBeLessThan(everything);
  });

  it("reports the same figure through policies() and findPolicy()", () => {
    for (const p of store.policies()) {
      expect(store.findPolicy(p.id)?.spent).toBeCloseTo(p.spent, 2);
    }
  });
});

describe("the seeded ledger supports the report honestly", () => {
  // The reason a1 existed: SpendingTrendChart substituted a hard-coded Jan–Jun
  // series whenever fewer than three distinct months were present, and the old
  // seed spanned exactly two — so the fallback was the default path and the
  // report showed invented figures. Three or more real months means the honest
  // branch is the only one the demo ever takes.
  it("spans at least three distinct months", () => {
    const months = new Set(
      store
        .transactions()
        .filter((t) => t.amount < 0)
        .map((t) => t.date.slice(0, 7)),
    );
    expect(months.size).toBeGreaterThanOrEqual(3);
  });

  it("keeps the scripted over-limit demo intact", () => {
    const policies = store.policies();
    const overLimit = store
      .transactions()
      .filter((t) => t.status === "pending" && isOverLimit(t, policies));

    // The teach-mode pill says "Approve the $15,000 AWS charge", so that charge
    // must exist, be pending, and genuinely derive over-limit.
    const aws = overLimit.find((t) => t.title === "AWS");
    expect(aws).toBeDefined();
    expect(Math.abs(aws!.amount)).toBe(15_000);
  });

  it("leaves exactly one Delta charge for the 'I don't recognize' pill", () => {
    const delta = store
      .transactions()
      .filter((t) => t.title.toLowerCase().includes("delta"));
    expect(delta).toHaveLength(1);
  });

  it("gives every ledger charge a team and category for the Charges table", () => {
    for (const t of store.transactions()) {
      expect(t.team, `${t.id} ${t.title}`).toBeDefined();
      expect(t.category, `${t.id} ${t.title}`).toBeDefined();
    }
  });
});
