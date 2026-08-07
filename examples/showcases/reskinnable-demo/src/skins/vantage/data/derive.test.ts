import { describe, expect, it } from "vitest";
import seed from "./seed.json";
import type { Db, Lens } from "./types";
import {
  monthsIn,
  comparisonMonths,
  computeSeries,
  computeKpis,
  computeVarianceWaterfall,
  computeBreakdown,
} from "./derive";

const db = seed as unknown as Db;
const base: Lens = {
  period: "q3-2026",
  compare: "qoq",
  segment: "all",
  region: "all",
  grain: "monthly",
  currency: "reported",
};

describe("monthsIn", () => {
  it("expands a quarter to its three months", () => {
    expect(monthsIn("q3-2026")).toEqual(["2026-07", "2026-08", "2026-09"]);
  });
  it("expands a half to six months and ttm to twelve", () => {
    expect(monthsIn("h1-2026")).toHaveLength(6);
    expect(monthsIn("ttm")).toHaveLength(12);
    expect(monthsIn("ttm").at(-1)).toBe("2026-09");
  });
});

describe("comparisonMonths", () => {
  it("qoq shifts back one window of equal length", () => {
    expect(comparisonMonths("q3-2026", "qoq")).toEqual([
      "2026-04",
      "2026-05",
      "2026-06",
    ]);
  });
  it("yoy shifts back twelve months", () => {
    expect(comparisonMonths("q3-2026", "yoy")).toEqual([
      "2025-07",
      "2025-08",
      "2025-09",
    ]);
  });
  it("vs-plan has no fact-table baseline — the plan table supplies it", () => {
    expect(comparisonMonths("q3-2026", "vs-plan")).toBeNull();
  });
});

describe("computeSeries", () => {
  it("gives one point per month at monthly grain and one per quarter at quarterly", () => {
    expect(
      computeSeries(db, { ...base, period: "h1-2026" }, "arr").points,
    ).toHaveLength(6);
    expect(
      computeSeries(
        db,
        { ...base, period: "h1-2026", grain: "quarterly" },
        "arr",
      ).points,
    ).toHaveLength(2);
  });

  it("REALLY filters by segment — a filtered total is strictly smaller than 'all'", () => {
    const all = computeSeries(db, base, "arr").total;
    const ent = computeSeries(
      db,
      { ...base, segment: "enterprise" },
      "arr",
    ).total;
    expect(ent).toBeGreaterThan(0);
    expect(ent).toBeLessThan(all);
  });

  it("REALLY filters by region", () => {
    const all = computeSeries(db, base, "arr").total;
    const emea = computeSeries(db, { ...base, region: "emea" }, "arr").total;
    expect(emea).toBeLessThan(all);
  });

  it("constant currency is a DIFFERENT number from reported for a non-USD region", () => {
    const reported = computeSeries(
      db,
      { ...base, region: "emea" },
      "arr",
    ).total;
    const constant = computeSeries(
      db,
      { ...base, region: "emea", currency: "constant" },
      "arr",
    ).total;
    expect(constant).not.toBe(reported);
  });

  it("leaves NAMER unchanged by constant currency (it is the reporting currency)", () => {
    const reported = computeSeries(
      db,
      { ...base, region: "namer" },
      "arr",
    ).total;
    const constant = computeSeries(
      db,
      { ...base, region: "namer", currency: "constant" },
      "arr",
    ).total;
    expect(constant).toBeCloseTo(reported, 0);
  });

  it("qoq and yoy produce different comparisons for the same window", () => {
    const qoq = computeSeries(
      db,
      { ...base, compare: "qoq" },
      "arr",
    ).comparison;
    const yoy = computeSeries(
      db,
      { ...base, compare: "yoy" },
      "arr",
    ).comparison;
    expect(qoq?.baseline).not.toBe(yoy?.baseline);
    expect(qoq?.delta).not.toBe(yoy?.delta);
  });

  it("vs-plan compares against the plan table", () => {
    const cmp = computeSeries(
      db,
      { ...base, compare: "vs-plan" },
      "arr",
    ).comparison;
    expect(cmp?.basis).toBe("vs-plan");
    expect(cmp?.baselineLabel).toBe("Plan");
    expect(cmp?.baseline).toBeGreaterThan(0);
  });

  it("shows EMEA missing plan in Q3 2026 while NAMER does not", () => {
    const emea = computeSeries(
      db,
      { ...base, region: "emea", compare: "vs-plan" },
      "arr",
    );
    const namer = computeSeries(
      db,
      { ...base, region: "namer", compare: "vs-plan" },
      "arr",
    );
    expect(emea.comparison!.deltaPct).toBeLessThan(namer.comparison!.deltaPct);
  });

  it("carries the metric's unit through, so formatters never guess", () => {
    expect(computeSeries(db, base, "arr").unit).toBe("usd");
    expect(computeSeries(db, base, "cac_payback").unit).toBe("months");
    expect(computeSeries(db, base, "logo_churn").unit).toBe("pct");
  });
});

describe("computeKpis", () => {
  it("returns the four default tiles with a sparkline each", () => {
    const kpis = computeKpis(db, base);
    expect(kpis.map((k) => k.metric)).toEqual([
      "arr",
      "pipeline_coverage",
      "cac_payback",
      "logo_churn",
    ]);
    for (const k of kpis) expect(k.sparkline.length).toBeGreaterThan(1);
  });
});

describe("computeVarianceWaterfall", () => {
  it("starts at plan, ends at actual, and its deltas reconcile exactly", () => {
    const steps = computeVarianceWaterfall(db, { ...base, compare: "vs-plan" });
    const start = steps.find((s) => s.kind === "start")!;
    const end = steps.find((s) => s.kind === "end")!;
    const deltas = steps.filter((s) => s.kind === "delta");
    expect(deltas.length).toBe(3); // one per region
    const reconciled =
      start.value + deltas.reduce((sum, d) => sum + d.value, 0);
    expect(reconciled).toBeCloseTo(end.value, 0);
  });

  it("ends at the INDEPENDENTLY computed actual total, not merely at start+deltas", () => {
    // The assertion above is tautological on its own: computeVarianceWaterfall
    // derives `end` as start + sum(deltas), so it can never disagree with
    // itself. The property that actually matters is that the bar labelled
    // "Actual" equals the ARR the rest of the app reports for the same lens —
    // otherwise the waterfall reconciles beautifully to the wrong number.
    const lens = { ...base, compare: "vs-plan" as const };
    const end = computeVarianceWaterfall(db, lens).find(
      (s) => s.kind === "end",
    )!;
    expect(end.value).toBeCloseTo(computeSeries(db, lens, "arr").total, 0);
  });

  it("attributes the largest negative delta to EMEA in Q3 2026", () => {
    const deltas = computeVarianceWaterfall(db, { ...base, compare: "vs-plan" })
      .filter((s) => s.kind === "delta")
      .sort((a, b) => a.value - b.value);
    expect(deltas[0].label).toBe("EMEA");
    expect(deltas[0].value).toBeLessThan(0);
  });
});

describe("computeBreakdown", () => {
  it("splits by the requested dimension and shares sum to 1", () => {
    const rows = computeBreakdown(db, base, "arr", "segment");
    expect(rows.map((r) => r.key).sort()).toEqual([
      "enterprise",
      "mid-market",
      "smb",
    ]);
    expect(rows.reduce((sum, r) => sum + r.share, 0)).toBeCloseTo(1, 5);
  });

  it("sorts descending by value so the biggest contributor reads first", () => {
    const rows = computeBreakdown(db, base, "arr", "region");
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].value).toBeGreaterThanOrEqual(rows[i].value);
    }
  });
});
