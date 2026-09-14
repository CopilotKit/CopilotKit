import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

/**
 * DELIBERATELY OUT OF PERIOD ORDER. The getter sorts by period before it
 * windows, and against a pre-sorted fixture that sort is untested: deleting it
 * left every assertion here green while `months` started keeping whichever
 * periods happened to come last in the snapshot. The rows below are shuffled so
 * the ordering assertions measure the getter, not the fixture.
 */
const points: LedgerMetricPoint[] = [
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
    metricId: "revenue",
    period: "2025-11",
    department: "all",
    plan: 100,
    actual: 95,
    forecast: 98,
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
  {
    metricId: "revenue",
    period: "2025-12",
    department: "all",
    plan: 100,
    actual: 105,
    forecast: 102,
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
// The unknown-id cases stub `console.error`; without this the stub leaks into
// every later case and a real fail-loud log would go unseen.
afterEach(() => vi.restoreAllMocks());

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

  it("returns the rows in period order, whatever order the snapshot holds", async () => {
    // The snapshot fixture is shuffled; the sandbox's chart code reads this
    // array positionally, so an unsorted series draws a scrambled trend line.
    const out = (await fn("getMetricSeries").handler({
      metricId: "revenue",
    })) as Array<{ period: string }>;
    expect(out.map((p) => p.period)).toEqual(["2025-11", "2025-12", "2026-01"]);
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
    // would let iframe JS mutate the app's snapshot through it. Asserted
    // against EVERY source row, not `points[0]`, because the fixture is
    // deliberately unsorted and `out[0]` is no longer the first row in it.
    expect(points as unknown[]).not.toContain(out[0]);
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

  /**
   * THE `months` CONTRACT: only a positive, finite number narrows.
   *
   * `store.ts`'s `periodWindow` already fixed this for the app's own getter and
   * documents the semantics; this getter kept the plain `if (months)` and so
   * mishandled two of the three reachable bad values. `months` reaches here off
   * LLM-authored JS inside the sandbox iframe, which is the least constrained
   * caller in the app — the zod schema guards the tool CALL, not this handler.
   *
   * The window is the last N DISTINCT periods, so `1.5` must floor to one
   * period rather than reaching back into a second.
   */
  it.each([
    ["0 (falsy, so `if (months)` skipped the window entirely)", 0],
    [
      "-3 (`slice(-(-3))` returned the OLDEST periods — an INVERTED window)",
      -3,
    ],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
  ])("returns the full history for months = %s", async (_label, months) => {
    const out = (await fn("getMetricSeries").handler({
      metricId: "revenue",
      months,
    })) as Array<{ period: string }>;
    expect(out.map((p) => p.period)).toEqual(["2025-11", "2025-12", "2026-01"]);
  });

  it("floors a fractional months rather than reaching back a period", async () => {
    const out = (await fn("getMetricSeries").handler({
      metricId: "revenue",
      months: 1.5,
    })) as Array<{ period: string }>;
    expect(out.map((p) => p.period)).toEqual(["2026-01"]);
  });

  /**
   * FAIL LOUD ON AN ID NOTHING KNOWS. An unknown `metricId` or `department`
   * filters to zero rows, which is byte-identical to "this metric has no data
   * yet" — so a model that hallucinates `"revenue_total"` gets a legitimate
   * empty series back and renders an empty chart nobody can explain. The empty
   * result stays (there is nothing to return), but the console names the id.
   */
  it("logs the unknown id when metricId is not one this skin defines", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const out = (await fn("getMetricSeries").handler({
      metricId: "revenue_total",
    })) as unknown[];
    expect(out).toEqual([]);
    expect(String(consoleError.mock.calls[0]?.join(" "))).toContain(
      "revenue_total",
    );
  });

  it("logs the unknown id when department is not one this skin defines", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const out = (await fn("getMetricSeries").handler({
      metricId: "opex",
      department: "logistics",
    })) as unknown[];
    expect(out).toEqual([]);
    expect(String(consoleError.mock.calls[0]?.join(" "))).toContain(
      "logistics",
    );
  });

  it("stays quiet for a known metric that simply has no rows yet", async () => {
    // The counterpart the guard above needs: "no data" must NOT be reported as
    // an unknown id, or the console cries wolf on every un-backfilled metric.
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const out = (await fn("getMetricSeries").handler({
      metricId: "nps",
    })) as unknown[];
    expect(out).toEqual([]);
    expect(consoleError).not.toHaveBeenCalled();
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
