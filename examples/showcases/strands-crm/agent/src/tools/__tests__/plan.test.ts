import { describe, it, expect } from "vitest";
import { planPipelineTool } from "../plan.js";

describe("plan_pipeline tool", () => {
  it("invoke({}) returns an object with generatedAt, totalOpen, and priorities array", async () => {
    const result = await planPipelineTool.invoke({});
    const r = result as any;
    expect(typeof r.generatedAt).toBe("string");
    expect(r.generatedAt.length).toBeGreaterThan(0);
    expect(typeof r.totalOpen).toBe("number");
    expect(r.totalOpen).toBeGreaterThan(0);
    expect(Array.isArray(r.priorities)).toBe(true);
  });

  it("priorities length is at most 3 by default", async () => {
    const result = await planPipelineTool.invoke({});
    const r = result as any;
    expect(r.priorities.length).toBeLessThanOrEqual(3);
  });

  it("each priority has required fields: dealId, dealName, accountName, risk, reason, nextStep", async () => {
    const result = await planPipelineTool.invoke({});
    const r = result as any;
    for (const p of r.priorities) {
      expect(typeof p.dealId).toBe("string");
      expect(typeof p.dealName).toBe("string");
      expect(typeof p.accountName).toBe("string");
      expect(["low", "medium", "high"]).toContain(p.risk);
      expect(typeof p.reason).toBe("string");
      expect(p.reason.length).toBeGreaterThan(0);
      expect(typeof p.nextStep).toBe("string");
      expect(p.nextStep.length).toBeGreaterThan(0);
    }
  });

  it("invoke({ topN: 2 }) respects topN parameter", async () => {
    const result = await planPipelineTool.invoke({ topN: 2 });
    const r = result as any;
    expect(r.priorities.length).toBeLessThanOrEqual(2);
  });

  it("invoke({}) defaults focus to 'all' and includes a rest array", async () => {
    const r = (await planPipelineTool.invoke({})) as any;
    expect(r.focus).toBe("all");
    expect(Array.isArray(r.rest)).toBe(true);
  });

  it("invoke({ focus: 'at_risk' }) returns an at-risk plan with no low-risk deals", async () => {
    const r = (await planPipelineTool.invoke({ focus: "at_risk" })) as any;
    expect(r.focus).toBe("at_risk");
    expect(Array.isArray(r.rest)).toBe(true);
    for (const d of [...r.priorities, ...r.rest]) {
      expect(d.risk).not.toBe("low");
    }
  });
});
