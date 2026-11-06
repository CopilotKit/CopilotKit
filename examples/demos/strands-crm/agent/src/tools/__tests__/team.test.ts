import { describe, it, expect } from "vitest";
import { analyzeTeamTool, repPerformanceTool } from "../team.js";

describe("analyze_team tool", () => {
  it("invoke({}) returns team aggregates with the expected shape", async () => {
    const r = (await analyzeTeamTool.invoke({})) as any;
    expect(typeof r.totalBookings).toBe("number");
    expect(typeof r.weightedForecast).toBe("number");
    // winRate is number | null
    expect(r.winRate === null || typeof r.winRate === "number").toBe(true);
    expect(Array.isArray(r.leaderboard)).toBe(true);
    expect(r.leaderboard.length).toBeGreaterThan(0);
    expect(Array.isArray(r.byCategory)).toBe(true);
  });

  it("each leaderboard row has the documented fields", async () => {
    const r = (await analyzeTeamTool.invoke({})) as any;
    for (const row of r.leaderboard) {
      expect(typeof row.salespersonId).toBe("string");
      expect(typeof row.name).toBe("string");
      expect(typeof row.bookings).toBe("number");
      expect(typeof row.openPipeline).toBe("number");
      expect(typeof row.attainment).toBe("number");
      expect(typeof row.quota).toBe("number");
      expect(typeof row.dealCount).toBe("number");
    }
  });

  it("leaderboard is sorted by bookings descending", async () => {
    const r = (await analyzeTeamTool.invoke({})) as any;
    for (let i = 1; i < r.leaderboard.length; i++) {
      expect(r.leaderboard[i - 1].bookings).toBeGreaterThanOrEqual(
        r.leaderboard[i].bookings,
      );
    }
  });

  it("accepts an optional period without breaking", async () => {
    const r = (await analyzeTeamTool.invoke({ period: "this-quarter" })) as any;
    expect(Array.isArray(r.leaderboard)).toBe(true);
  });
});

describe("rep_performance tool", () => {
  it("resolves a rep by name (Maya) and returns rep stats shape", async () => {
    const r = (await repPerformanceTool.invoke({ name: "Maya" })) as any;
    expect(r.rep).toBeTruthy();
    expect(r.rep.id).toBe("s2");
    expect(r.rep.name).toBe("Maya Chen");
    expect(typeof r.bookings).toBe("number");
    expect(typeof r.openPipeline).toBe("number");
    expect(typeof r.attainment).toBe("number");
    expect(r.winRate === null || typeof r.winRate === "number").toBe(true);
    expect(typeof r.dealCount).toBe("number");
    expect(Array.isArray(r.trend)).toBe(true);
    expect(r.trend.length).toBe(8);
    expect(Array.isArray(r.deals)).toBe(true);
  });

  it("resolves a rep by repId (s2)", async () => {
    const r = (await repPerformanceTool.invoke({ repId: "s2" })) as any;
    expect(r.rep.id).toBe("s2");
    expect(r.rep.name).toBe("Maya Chen");
  });

  it("every returned deal is owned by the resolved rep", async () => {
    const r = (await repPerformanceTool.invoke({ name: "Maya" })) as any;
    for (const d of r.deals) {
      expect(d.ownerId).toBe("s2");
    }
  });

  it("throws when neither name nor repId resolves a rep", async () => {
    await expect(
      repPerformanceTool.invoke({ name: "Nobody Atall" }),
    ).rejects.toThrow(/salesperson|rep/i);
    await expect(repPerformanceTool.invoke({})).rejects.toThrow(
      /salesperson|rep|name|id/i,
    );
  });
});
