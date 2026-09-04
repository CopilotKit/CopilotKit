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

/**
 * THE FIXTURE CARRIES A FIELD THE DTO MUST DROP.
 *
 * The projection assertions below are `toEqual` against the exact DTO keys,
 * which is only a real allowlist check if the SOURCE row has something extra
 * in it. Against a fixture whose rows are already DTO-shaped, a handler that
 * returned `snapshot.points` untouched — no `toSafeMetricPoint` at all —
 * satisfies every one of them: there was nothing to leak.
 *
 * `internalNote` stands in for whatever a domain row grows next (an author, an
 * approval trail, an internal comment). Nothing in the iframe's
 * LLM-authored JS is entitled to it, and the boundary the DTOs exist to hold
 * is the only thing keeping it out.
 */
const LEAKED_NOTE = "internal: do not surface to the sandbox";
type LedgerMetricPoint = MetricPoint & { internalNote: string };
type LedgerException = Exception & { internalNote: string };

/** The DTO keys each projection is allowed to emit — `internalNote` is not among them. */
const SAFE_POINT_KEYS = [
  "metricId",
  "period",
  "department",
  "plan",
  "actual",
  "forecast",
];
const SAFE_EXCEPTION_KEYS = [
  "metricId",
  "period",
  "department",
  "variancePct",
  "explained",
];

const points: LedgerMetricPoint[] = [
  {
    metricId: "revenue",
    period: "2025-11",
    department: "all",
    plan: 100,
    actual: 95,
    forecast: 98,
    internalNote: LEAKED_NOTE,
  },
  {
    metricId: "revenue",
    period: "2025-12",
    department: "all",
    plan: 100,
    actual: 105,
    forecast: 102,
    internalNote: LEAKED_NOTE,
  },
  {
    metricId: "revenue",
    period: "2026-01",
    department: "all",
    plan: 100,
    actual: 110,
    forecast: 108,
    internalNote: LEAKED_NOTE,
  },
  {
    metricId: "opex",
    period: "2026-01",
    department: "manufacturing",
    plan: 50,
    actual: 55,
    forecast: 52,
    internalNote: LEAKED_NOTE,
  },
  {
    metricId: "opex",
    period: "2026-01",
    department: "corporate",
    plan: 20,
    actual: 18,
    forecast: 19,
    internalNote: LEAKED_NOTE,
  },
];
const exceptions: LedgerException[] = [
  {
    metricId: "opex",
    period: "2026-01",
    department: "manufacturing",
    variancePct: 0.1,
    explained: false,
    internalNote: LEAKED_NOTE,
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

  it("drops every field outside the DTO allowlist", async () => {
    const out = (await fn("getMetricSeries").handler({
      metricId: "revenue",
    })) as Record<string, unknown>[];

    // The fixture rows all carry `internalNote`; no projected row may.
    for (const row of out) {
      expect(row.internalNote, "leaked a non-DTO field").toBeUndefined();
      expect(Object.keys(row).sort()).toEqual([...SAFE_POINT_KEYS].sort());
    }
    expect(JSON.stringify(out)).not.toContain(LEAKED_NOTE);

    // And the projection is a COPY: handing the sandbox the live domain row
    // would let iframe JS mutate the app's snapshot through it.
    expect(out[0]).not.toBe(points[0]);
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

  /**
   * `"all"` IS A VALUE OF THE FIELD, NOT A DEPARTMENT. It is in the parameter
   * enum and the schema's own `.describe()` tells the model to pass it for the
   * company-wide series, so it has to narrow to exactly the `"all"` rows —
   * not fall through as "no department given" and return every department's
   * series, which would answer a company-wide question with four series.
   */
  it('narrows to the company-wide series when department is "all"', async () => {
    setSandboxSnapshot({
      ...fixture,
      points: [
        ...points,
        {
          metricId: "opex",
          period: "2026-01",
          department: "all",
          plan: 70,
          actual: 73,
          forecast: 71,
          internalNote: LEAKED_NOTE,
        },
      ],
    });

    const out = (await fn("getMetricSeries").handler({
      metricId: "opex",
      department: "all",
    })) as Array<{ department: string; actual: number }>;

    expect(out).toHaveLength(1);
    expect(out[0].department).toBe("all");
    expect(out[0].actual).toBe(73);
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

  it("drops every field outside the DTO allowlist", async () => {
    const out = (await fn("getExceptions").handler({})) as Record<
      string,
      unknown
    >[];

    for (const row of out) {
      expect(row.internalNote, "leaked a non-DTO field").toBeUndefined();
      expect(Object.keys(row).sort()).toEqual([...SAFE_EXCEPTION_KEYS].sort());
    }
    expect(JSON.stringify(out)).not.toContain(LEAKED_NOTE);
    expect(out[0]).not.toBe(exceptions[0]);
  });
});
