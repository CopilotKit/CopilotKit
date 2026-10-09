import { describe, it, expect, beforeEach } from "vitest";
import {
  bookings,
  weightedForecast,
  winRate,
  salesOverTime,
  revenueByCategory,
  teamStats,
  repStats,
  weeklyReportMetrics,
} from "../analytics.js";
import { freshStore } from "../test-helpers.js";
import type { CrmStore } from "../store.js";
import type { CrmState } from "../types.js";

// Fixed "now" so every time-based assertion is deterministic. 2026-06-04 UTC.
const NOW = Date.parse("2026-06-04");

let crm: CrmState;
let store: CrmStore;
beforeEach(() => {
  store = freshStore();
  crm = store.getStateSnapshot();
});

describe("analytics — scalars", () => {
  it("bookings sums Closed-Won amounts (d6+d8+d9+d10)", () => {
    expect(bookings(crm)).toBe(197500);
  });

  it("bookings can be restricted to a closeDate period", () => {
    // Only May Closed-Won: d6 (May 10, 36k) + d10 (May 28, 90k) = 126k.
    expect(bookings(crm, "2026-05-01", "2026-05-31")).toBe(126000);
    // April only: d9 (25.5k).
    expect(bookings(crm, "2026-04-01", "2026-04-30")).toBe(25500);
    // A period with no wins.
    expect(bookings(crm, "2026-01-01", "2026-02-28")).toBe(0);
  });

  it("weightedForecast sums amount × probability/100 over open deals", () => {
    // d1 .4·42k + d2 .6·88k + d3 .2·15k + d4 .75·130k + d5 .15·54k + d7 .4·60k.
    expect(weightedForecast(crm)).toBe(202200);
  });

  it("winRate is won/(won+lost) — 4 won, 1 lost = 0.8", () => {
    expect(winRate(crm)).toBe(0.8);
  });

  it("winRate is null when there are no closed deals", () => {
    const noClosed: CrmState = {
      ...crm,
      deals: crm.deals.filter(
        (d) => d.stage !== "Closed Won" && d.stage !== "Closed Lost",
      ),
    };
    expect(winRate(noClosed)).toBeNull();
  });
});

describe("analytics — salesOverTime", () => {
  it("returns exactly 8 ascending months ending at the now-month", () => {
    const series = salesOverTime(crm, NOW);
    expect(series).toHaveLength(8);
    expect(series[0].month).toBe("2025-11");
    expect(series[7].month).toBe("2026-06");
    // strictly ascending by month string
    for (let i = 1; i < series.length; i++) {
      expect(series[i].month > series[i - 1].month).toBe(true);
    }
  });

  it("buckets Closed-Won amounts by closeDate month (zero months included)", () => {
    const byMonth = Object.fromEntries(
      salesOverTime(crm, NOW).map((p) => [p.month, p.bookings]),
    );
    expect(byMonth["2026-03"]).toBe(46000); // d8
    expect(byMonth["2026-04"]).toBe(25500); // d9
    expect(byMonth["2026-05"]).toBe(126000); // d6 + d10
    expect(byMonth["2026-06"]).toBe(0);
    expect(byMonth["2026-01"]).toBe(0);
  });

  it("uses 3-letter month labels", () => {
    const series = salesOverTime(crm, NOW);
    expect(series[7].label).toBe("Jun");
    expect(series.find((p) => p.month === "2026-03")!.label).toBe("Mar");
  });
});

describe("analytics — revenueByCategory", () => {
  it("sums qty×unitPrice of open deals' line items by category, skipping zero", () => {
    const byCat = Object.fromEntries(
      revenueByCategory(crm).map((c) => [c.category, c.value]),
    );
    expect(byCat).toEqual({
      Laptop: 276000,
      Workstation: 6000,
      Server: 78000,
      Display: 20000,
      Accessory: 9000,
    });
  });

  it("ignores closed deals' line items", () => {
    const onlyClosed: CrmState = {
      ...crm,
      deals: crm.deals.filter(
        (d) => d.stage === "Closed Won" || d.stage === "Closed Lost",
      ),
    };
    expect(revenueByCategory(onlyClosed)).toEqual([]);
  });
});

describe("analytics — teamStats", () => {
  it("reports team totals and a category breakdown", () => {
    const ts = teamStats(crm, NOW);
    expect(ts.totalBookings).toBe(197500);
    expect(ts.weightedForecast).toBe(202200);
    expect(ts.winRate).toBe(0.8);
    expect(ts.byCategory.length).toBe(5);
  });

  it("leaderboard is sorted by bookings desc with attainment = bookings/quota", () => {
    const lb = teamStats(crm, NOW).leaderboard;
    expect(lb.map((r) => r.salespersonId)).toEqual([
      "s2",
      "s1",
      "s3",
      "s4",
      "s5",
    ]);

    const maya = lb[0];
    expect(maya.name).toBe("Maya Chen");
    expect(maya.bookings).toBe(126000); // d6 + d10
    expect(maya.openPipeline).toBe(142000); // d2 (88k) + d5 (54k)
    expect(maya.dealCount).toBe(4);
    expect(maya.attainment).toBeCloseTo(126000 / 320000, 10);

    // Manager (quota 0) has 0 attainment, never NaN/Infinity.
    const mgr = lb.find((r) => r.salespersonId === "s5")!;
    expect(mgr.quota).toBe(0);
    expect(mgr.attainment).toBe(0);
  });
});

describe("analytics — repStats", () => {
  it("computes one rep's numbers, trend, and owned deals", () => {
    const rs = repStats(crm, "s1", NOW); // Nathan
    expect(rs.rep.name).toBe("Nathan Brooks");
    expect(rs.bookings).toBe(46000); // d8
    expect(rs.openPipeline).toBe(232000); // d1 42k + d4 130k + d7 60k
    expect(rs.dealCount).toBe(4);
    expect(rs.attainment).toBeCloseTo(46000 / 300000, 10);
    expect(rs.deals.map((d) => d.id).sort()).toEqual(["d1", "d4", "d7", "d8"]);
  });

  it("rep trend is an 8-length monthly bookings series for that rep only", () => {
    const rs = repStats(crm, "s1", NOW);
    expect(rs.trend).toHaveLength(8);
    // Nathan's only Closed-Won (d8) is March → index 4 in the Nov..Jun window.
    expect(rs.trend[4]).toBe(46000);
    expect(rs.trend.reduce((a, b) => a + b, 0)).toBe(46000);
  });

  it("throws for an unknown rep id", () => {
    expect(() => repStats(crm, "zzz", NOW)).toThrow(/not found/i);
  });
});

describe("analytics — weeklyReportMetrics", () => {
  it("scopes bookings/dealsWon to the period but pipeline/winRate to the snapshot", () => {
    const m = weeklyReportMetrics(crm, "2026-05-01", "2026-05-31", NOW);
    expect(m.bookings).toBe(126000); // d6 + d10 closed in May
    expect(m.dealsWon).toBe(2);
    expect(m.dealsOpen).toBe(6);
    expect(m.weightedForecast).toBe(202200); // current open pipeline
    expect(m.winRate).toBe(0.8); // overall
  });

  it("byStage covers all six stages with count + value", () => {
    const m = weeklyReportMetrics(crm, "2026-05-01", "2026-05-31", NOW);
    expect(m.byStage).toHaveLength(6);
    const won = m.byStage.find((s) => s.stage === "Closed Won")!;
    expect(won.count).toBe(4);
    expect(won.value).toBe(197500);
    const lost = m.byStage.find((s) => s.stage === "Closed Lost")!;
    expect(lost.count).toBe(1);
    expect(lost.value).toBe(18000);
  });

  it("leaderboard reflects in-period bookings, sorted desc", () => {
    const m = weeklyReportMetrics(crm, "2026-05-01", "2026-05-31", NOW);
    // Only Maya (s2) closed in May → she leads with 126k; everyone else 0.
    expect(m.leaderboard[0].salespersonId).toBe("s2");
    expect(m.leaderboard[0].bookings).toBe(126000);
    expect(m.leaderboard.slice(1).every((r) => r.bookings === 0)).toBe(true);
  });

  it("is deterministic for a fixed now", () => {
    const a = weeklyReportMetrics(crm, "2026-05-01", "2026-05-31", NOW);
    const b = weeklyReportMetrics(crm, "2026-05-01", "2026-05-31", NOW);
    expect(a).toEqual(b);
  });
});
