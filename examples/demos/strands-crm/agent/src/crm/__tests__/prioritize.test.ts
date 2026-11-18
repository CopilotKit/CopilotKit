import { describe, it, expect, beforeEach } from "vitest";
import { prioritizePipeline } from "../prioritize.js";
import { freshStore } from "../test-helpers.js";
import type { CrmStore } from "../store.js";

// Fixed "now" so tests are fully deterministic regardless of when they run.
// 2026-06-04 UTC midnight.
const NOW = Date.parse("2026-06-04");

let store: CrmStore;
beforeEach(() => {
  store = freshStore();
});

describe("prioritizePipeline", () => {
  it("returns at most topN priorities", () => {
    const plan = prioritizePipeline(store, 3, NOW);
    expect(plan.priorities.length).toBeLessThanOrEqual(3);
  });

  it("totalOpen equals the count of open deals in seed (6 open, 1 Closed Won)", () => {
    // Seed has d1–d5 + d7 open (Lead/Qualified/Proposal/Negotiation) and d6 Closed Won.
    const plan = prioritizePipeline(store, 10, NOW);
    expect(plan.totalOpen).toBe(6);
  });

  it("excludes Closed Won and Closed Lost deals from priorities", () => {
    const plan = prioritizePipeline(store, 10, NOW);
    for (const p of plan.priorities) {
      expect(p.stage).not.toBe("Closed Won");
      expect(p.stage).not.toBe("Closed Lost");
    }
  });

  it("priorities are sorted by score descending", () => {
    const plan = prioritizePipeline(store, 6, NOW);
    for (let i = 1; i < plan.priorities.length; i++) {
      expect(plan.priorities[i - 1].score).toBeGreaterThanOrEqual(
        plan.priorities[i].score,
      );
    }
  });

  it("every priority has non-empty reason and nextStep", () => {
    const plan = prioritizePipeline(store, 3, NOW);
    for (const p of plan.priorities) {
      expect(p.reason.length).toBeGreaterThan(0);
      expect(p.nextStep.length).toBeGreaterThan(0);
    }
  });

  it("every priority has a valid risk value", () => {
    const plan = prioritizePipeline(store, 6, NOW);
    for (const p of plan.priorities) {
      expect(["low", "medium", "high"]).toContain(p.risk);
    }
  });

  it("ranks high-risk deals above low-risk deals", () => {
    // d5 (Soylent, Lead, prob=15, high risk) and d3 (Initech, Lead, prob=20, high risk)
    // should outrank d4 (Umbrella, Negotiation, prob=75, low risk on 2026-06-04).
    const plan = prioritizePipeline(store, 6, NOW);
    const d4Index = plan.priorities.findIndex((p) => p.dealId === "d4");
    const d5Index = plan.priorities.findIndex((p) => p.dealId === "d5");
    // d5 is high risk → must outrank d4 which is low risk
    expect(d5Index).toBeLessThan(d4Index);
  });

  it("top deal is d5 (Soylent — highest risk score)", () => {
    // d5: Lead, prob=15 → high risk + value $54k + no urgency = 3054
    const plan = prioritizePipeline(store, 3, NOW);
    expect(plan.priorities[0].dealId).toBe("d5");
  });

  it("includes daysToClose on each priority", () => {
    const plan = prioritizePipeline(store, 3, NOW);
    for (const p of plan.priorities) {
      expect(typeof p.daysToClose).toBe("number");
    }
  });

  it("d4 has daysToClose=14 and low risk on 2026-06-04", () => {
    // d4 closeDate is "2026-06-18" → exactly 14 days out, NOT < 14, so risk = low
    const plan = prioritizePipeline(store, 6, NOW);
    const d4 = plan.priorities.find((p) => p.dealId === "d4");
    expect(d4).toBeDefined();
    expect(d4!.daysToClose).toBe(14);
    expect(d4!.risk).toBe("low");
  });

  it("reason and nextStep for d4 (Negotiation) reference address-blockers action", () => {
    const plan = prioritizePipeline(store, 6, NOW);
    const d4 = plan.priorities.find((p) => p.dealId === "d4")!;
    expect(d4.nextStep).toMatch(/blockers/i);
  });

  it("generatedAt is an ISO string matching the fixed now", () => {
    const plan = prioritizePipeline(store, 3, NOW);
    expect(plan.generatedAt).toBe(new Date(NOW).toISOString());
  });

  it("topN=1 returns exactly one priority", () => {
    const plan = prioritizePipeline(store, 1, NOW);
    expect(plan.priorities.length).toBe(1);
    expect(plan.totalOpen).toBe(6);
  });

  it("is deterministic — same result on repeated calls with same now", () => {
    const a = prioritizePipeline(store, 3, NOW);
    const b = prioritizePipeline(store, 3, NOW);
    expect(a.priorities.map((p) => p.dealId)).toEqual(
      b.priorities.map((p) => p.dealId),
    );
    expect(a.priorities.map((p) => p.score)).toEqual(
      b.priorities.map((p) => p.score),
    );
  });
});

describe("prioritizePipeline — focus + rest", () => {
  it("defaults focus to 'all' and echoes it on the plan", () => {
    const plan = prioritizePipeline(store, 3, NOW);
    expect(plan.focus).toBe("all");
  });

  it("partitions all open deals into priorities + rest (focus=all)", () => {
    const plan = prioritizePipeline(store, 3, NOW);
    expect(Array.isArray(plan.rest)).toBe(true);
    expect(plan.priorities.length + plan.rest.length).toBe(plan.totalOpen);
  });

  it("rest deals rank below the last priority and are sorted by score descending", () => {
    const plan = prioritizePipeline(store, 3, NOW);
    const lastPriorityScore = plan.priorities[plan.priorities.length - 1].score;
    for (const r of plan.rest) {
      expect(r.score).toBeLessThanOrEqual(lastPriorityScore);
    }
    for (let i = 1; i < plan.rest.length; i++) {
      expect(plan.rest[i - 1].score).toBeGreaterThanOrEqual(plan.rest[i].score);
    }
  });

  it("focus='at_risk' echoes focus and excludes low-risk deals from priorities and rest", () => {
    const plan = prioritizePipeline(store, 3, NOW, "at_risk");
    expect(plan.focus).toBe("at_risk");
    for (const d of [...plan.priorities, ...plan.rest]) {
      expect(d.risk).not.toBe("low");
    }
  });

  it("focus='at_risk' returns exactly the open deals that are not low-risk", () => {
    const all = prioritizePipeline(store, 99, NOW);
    const expectedAtRisk = [...all.priorities, ...all.rest].filter(
      (d) => d.risk !== "low",
    ).length;
    const atRisk = prioritizePipeline(store, 3, NOW, "at_risk");
    expect(atRisk.priorities.length + atRisk.rest.length).toBe(expectedAtRisk);
  });
});
