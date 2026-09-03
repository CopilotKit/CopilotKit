import { describe, it, expect, beforeEach } from "vitest";
import { sandboxFunctions, setSandboxSnapshot } from "./sandbox-functions";
import type {
  Exception,
  LedgerSnapshot,
  MetricPoint,
} from "@/skins/exec/data/types";

const fn = (name: string) => {
  const f = sandboxFunctions.find((s) => s.name === name);
  if (!f) throw new Error(`no sandbox function named ${name}`);
  return f;
};

const points: MetricPoint[] = [
  {
    metricId: "revenue",
    period: "2025-11",
    department: "all",
    plan: 100,
    actual: 95,
    forecast: 98,
  },
  {
    metricId: "revenue",
    period: "2025-12",
    department: "all",
    plan: 100,
    actual: 105,
    forecast: 102,
  },
  {
    metricId: "revenue",
    period: "2026-01",
    department: "all",
    plan: 100,
    actual: 110,
    forecast: 108,
  },
  {
    metricId: "opex",
    period: "2026-01",
    department: "manufacturing",
    plan: 50,
    actual: 55,
    forecast: 52,
  },
  {
    metricId: "opex",
    period: "2026-01",
    department: "corporate",
    plan: 20,
    actual: 18,
    forecast: 19,
  },
];
const exceptions: Exception[] = [
  {
    metricId: "opex",
    period: "2026-01",
    department: "manufacturing",
    variancePct: 0.1,
    explained: false,
  },
];

const fixture: LedgerSnapshot = {
  metricDefs: [],
  points,
  initiatives: [],
  narratives: [],
  dashboards: {
    ceo: { id: "ceo", title: "CEO", blocks: [] },
    cfo: { id: "cfo", title: "CFO", blocks: [] },
  },
  packs: [],
  exceptions,
};

beforeEach(() => setSandboxSnapshot(fixture));

describe("getMetricSeries", () => {
  it("projects points to plan/actual/forecast rows for the requested metric", async () => {
    const out = (await fn("getMetricSeries").handler({
      metricId: "revenue",
    })) as Record<string, unknown>[];
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({
      metricId: "revenue",
      period: "2025-11",
      department: "all",
      plan: 100,
      actual: 95,
      forecast: 98,
    });
  });

  it("narrows rows when filtered by department", async () => {
    const out = (await fn("getMetricSeries").handler({
      metricId: "opex",
    })) as Array<{ department: string }>;
    expect(out).toHaveLength(2);

    const filtered = (await fn("getMetricSeries").handler({
      metricId: "opex",
      department: "manufacturing",
    })) as Array<{ department: string }>;
    expect(filtered).toHaveLength(1);
    expect(filtered[0].department).toBe("manufacturing");
  });

  it("narrows rows when filtered by months", async () => {
    const out = (await fn("getMetricSeries").handler({
      metricId: "revenue",
    })) as Array<{
      period: string;
    }>;
    expect(out).toHaveLength(3);

    const limited = (await fn("getMetricSeries").handler({
      metricId: "revenue",
      months: 2,
    })) as Array<{ period: string }>;
    expect(limited).toHaveLength(2);
    expect(limited.map((p) => p.period)).toEqual(["2025-12", "2026-01"]);
  });

  it("keeps every department's series for the latest period when limited by months", async () => {
    setSandboxSnapshot({
      ...fixture,
      points: [
        ...points,
        {
          metricId: "opex",
          period: "2025-12",
          department: "manufacturing",
          plan: 48,
          actual: 47,
          forecast: 48,
        },
        {
          metricId: "opex",
          period: "2025-12",
          department: "corporate",
          plan: 19,
          actual: 20,
          forecast: 19,
        },
      ],
    });

    const out = (await fn("getMetricSeries").handler({
      metricId: "opex",
      months: 1,
    })) as Array<{ period: string; department: string }>;
    expect(out).toHaveLength(2);
    expect(out.every((p) => p.period === "2026-01")).toBe(true);
    expect(new Set(out.map((p) => p.department))).toEqual(
      new Set(["manufacturing", "corporate"]),
    );
  });
});

describe("getExceptions", () => {
  it("projects exceptions to metricId/period/department/variancePct/explained", async () => {
    const out = (await fn("getExceptions").handler({})) as Record<
      string,
      unknown
    >[];
    expect(out).toEqual([
      {
        metricId: "opex",
        period: "2026-01",
        department: "manufacturing",
        variancePct: 0.1,
        explained: false,
      },
    ]);
  });
});
