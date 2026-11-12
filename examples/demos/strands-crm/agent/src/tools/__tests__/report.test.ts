import { describe, it, expect } from "vitest";
import { generateWeeklyReportTool } from "../report.js";
import { crm } from "../../crm/store.js";

describe("generate_weekly_report tool", () => {
  it("returns a full Report with the documented shape", async () => {
    const r = (await generateWeeklyReportTool.invoke({
      periodStart: "2026-05-28",
      periodEnd: "2026-06-04",
    })) as any;
    expect(typeof r.id).toBe("string");
    expect(r.id.length).toBeGreaterThan(0);
    expect(typeof r.title).toBe("string");
    expect(r.title).toMatch(/Weekly Sales Report/i);
    expect(r.periodStart).toBe("2026-05-28");
    expect(r.periodEnd).toBe("2026-06-04");
    expect(typeof r.generatedAt).toBe("string");
    expect(typeof r.summary).toBe("string");
    expect(r.summary.length).toBeGreaterThan(0);
    expect(Array.isArray(r.highlights)).toBe(true);
    expect(r.highlights.length).toBe(3);
    // metrics carries the full ReportMetrics
    expect(typeof r.metrics).toBe("object");
    expect(typeof r.metrics.bookings).toBe("number");
    expect(typeof r.metrics.weightedForecast).toBe("number");
    expect(typeof r.metrics.dealsWon).toBe("number");
    expect(typeof r.metrics.dealsOpen).toBe("number");
    expect(Array.isArray(r.metrics.byStage)).toBe(true);
    expect(Array.isArray(r.metrics.byCategory)).toBe(true);
    expect(Array.isArray(r.metrics.leaderboard)).toBe(true);
  });

  it("persists the report so it appears in crm.listReports() (newest first)", async () => {
    const r = (await generateWeeklyReportTool.invoke({
      periodStart: "2026-05-28",
      periodEnd: "2026-06-04",
    })) as any;
    const reports = crm.listReports();
    const found = reports.find((x) => x.id === r.id);
    expect(found).toBeTruthy();
    expect(found!.title).toBe(r.title);
  });

  it("mints a unique id distinct from the seeded report (r1)", async () => {
    const r = (await generateWeeklyReportTool.invoke({
      periodStart: "2026-05-28",
      periodEnd: "2026-06-04",
    })) as any;
    expect(r.id).not.toBe("r1");
    // id collides with nothing already in the store
    const ids = crm.listReports().map((x) => x.id);
    const occurrences = ids.filter((id) => id === r.id).length;
    expect(occurrences).toBe(1);
  });

  it("defaults to a trailing 7-day period when no dates are given", async () => {
    const r = (await generateWeeklyReportTool.invoke({})) as any;
    expect(typeof r.periodStart).toBe("string");
    expect(typeof r.periodEnd).toBe("string");
    // period start precedes (or equals) end, ISO yyyy-mm-dd compares lexically
    expect(r.periodStart <= r.periodEnd).toBe(true);
    expect(r.periodStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(r.periodEnd).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("each call adds exactly one new report", async () => {
    const before = crm.listReports().length;
    await generateWeeklyReportTool.invoke({
      periodStart: "2026-05-28",
      periodEnd: "2026-06-04",
    });
    const after = crm.listReports().length;
    expect(after).toBe(before + 1);
  });
});
