import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEPARTMENT_VALUES,
  filterMetricRows,
  normalizePeriodLever,
  parseTopLever,
} from "./metric-rows";
import {
  explorerReadableRows,
  formatMetricValue,
  nextLeverSearchParams,
  periodSelectOptions,
} from "./metrics-explorer";
import type {
  Dashboard,
  LedgerSnapshot,
  MetricDef,
  MetricId,
  MetricPoint,
} from "../data/types";

// `formatMetricValue`'s fail-loud arm is asserted with a `console.error` spy;
// restore it so a later suite's real error still reaches the console.
afterEach(() => vi.restoreAllMocks());

/**
 * A synthetic snapshot, not the app's live seed. The plan's test case turns
 * on top-5 among MORE than five breaching Distribution metrics, and the real
 * seed (`data/seed.ts`) deliberately keeps only one department-level breach
 * (`opex`/distribution); its whole breach budget is three unexplained
 * exceptions, one per gate the demo's teaching narrative has to hit (see that
 * file's breach block). Depending on that count here would
 * make this test fail the moment the seed's breach budget changes for
 * reasons that have nothing to do with `filterMetricRows`.
 */
function def(id: MetricId, thresholdPct: number): MetricDef {
  return {
    id,
    label: `Label ${id}`,
    unit: "usd",
    audience: "both",
    thresholdPct,
    byDepartment: true,
  };
}

function point(
  metricId: MetricId,
  department: MetricPoint["department"],
  plan: number,
  actual: number,
  period = "2024-06",
): MetricPoint {
  return { metricId, period, department, plan, actual, forecast: plan };
}

const EMPTY_DASHBOARD = (id: "ceo" | "cfo"): Dashboard => ({
  id,
  title: id,
  blocks: [],
});

function buildSnapshot(): LedgerSnapshot {
  return {
    metricDefs: [
      def("dsoDays", 0.05),
      def("revenue", 0.05),
      def("arAgingDays", 0.05),
      def("headcountCost", 0.05),
      def("opex", 0.05),
      def("burnRate", 0.05),
      def("cash", 0.05),
      def("ebitda", 0.05),
    ],
    points: [
      // Distribution — six breaching rows, |variance| deliberately distinct
      // so descending order is unambiguous: dso .50, revenue .30, arAging
      // .20, headcountCost .10, opex .09, burnRate .06.
      //
      // INSERTION ORDER IS DELIBERATELY NOT THE SORTED ORDER. Listed
      // descending, the top-N test passes whether or not `filterMetricRows`
      // sorts at all — `slice(0, 5)` over an already-descending array returns
      // the expected five in the expected order, so deleting the `.sort()`
      // keeps the suite green. Shuffled, the sort is the only thing that can
      // produce the expected order, and it is also what decides WHICH five
      // survive the slice (insertion order would keep burnRate .06 and drop
      // arAgingDays .20).
      point("opex", "distribution", 100, 109), // |0.09|
      point("dsoDays", "distribution", 100, 50), // |-0.50|
      point("headcountCost", "distribution", 100, 90), // |-0.10|
      point("burnRate", "distribution", 100, 106), // |0.06|
      point("revenue", "distribution", 100, 130), // |0.30|
      point("arAgingDays", "distribution", 100, 120), // |0.20|
      // Distribution — two NON-breaching rows, to prove `threshold=1` excludes them.
      point("cash", "distribution", 100, 101), // |0.01|
      point("ebitda", "distribution", 100, 100), // |0|
      // Other scopes, to prove `department=distribution` excludes them even
      // though both breach.
      point("revenue", "manufacturing", 100, 200), // |1.0|
      point("dsoDays", "all", 100, 40), // |-0.60|
    ],
    initiatives: [],
    narratives: [],
    dashboards: { ceo: EMPTY_DASHBOARD("ceo"), cfo: EMPTY_DASHBOARD("cfo") },
    packs: [],
    exceptions: [],
  };
}

describe("parseTopLever", () => {
  it("accepts only positive integers", () => {
    expect(parseTopLever("5")).toBe(5);
    expect(parseTopLever("1")).toBe(1);
  });
  it("drops a fractional value rather than rounding it", () => {
    expect(parseTopLever("2.5")).toBeNull();
  });
  it("drops a negative or zero value rather than clamping it", () => {
    expect(parseTopLever("-1")).toBeNull();
    expect(parseTopLever("0")).toBeNull();
  });
  it("drops junk and absent values", () => {
    expect(parseTopLever("abc")).toBeNull();
    expect(parseTopLever(null)).toBeNull();
    expect(parseTopLever(undefined)).toBeNull();
  });
});

describe("filterMetricRows", () => {
  it("returns every row when no lever is set", () => {
    const snapshot = buildSnapshot();
    const rows = filterMetricRows(new URLSearchParams(), snapshot);
    expect(rows).toHaveLength(snapshot.points.length);
  });

  it("plan's case: department + threshold + top-5, ordered by descending |variance|", () => {
    const snapshot = buildSnapshot();
    const rows = filterMetricRows(
      new URLSearchParams("department=distribution&top=5&threshold=1"),
      snapshot,
    );
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.department === "distribution")).toBe(true);
    expect(rows.every((r) => r.breaching)).toBe(true);
    expect(rows.map((r) => r.metricId)).toEqual([
      "dsoDays",
      "revenue",
      "arAgingDays",
      "headcountCost",
      "opex",
    ]);

    // The ORDERING QUANTITY itself, not just the ids: every |variance| in the
    // fixture is distinct, so this pins one exact descending sequence. A
    // stable-but-unsorted result cannot produce it.
    const magnitudes = rows.map((r) =>
      Number(Math.abs(r.variancePct).toFixed(4)),
    );
    expect(magnitudes).toEqual([0.5, 0.3, 0.2, 0.1, 0.09]);
    // Distinct, so "descending" below is STRICT — a tie would let an
    // unsorted order slip past a >= comparison.
    expect(new Set(magnitudes).size).toBe(magnitudes.length);
    for (let i = 1; i < rows.length; i++) {
      expect(Math.abs(rows[i - 1].variancePct)).toBeGreaterThan(
        Math.abs(rows[i].variancePct),
      );
    }
  });

  it("ignores a fractional top, narrowing nothing beyond department + threshold", () => {
    const snapshot = buildSnapshot();
    const rows = filterMetricRows(
      new URLSearchParams("department=distribution&top=2.5&threshold=1"),
      snapshot,
    );
    // All six breaching Distribution rows, unsliced.
    expect(rows).toHaveLength(6);
  });

  it("ignores a negative top, narrowing nothing beyond department + threshold", () => {
    const snapshot = buildSnapshot();
    const rows = filterMetricRows(
      new URLSearchParams("department=distribution&top=-1&threshold=1"),
      snapshot,
    );
    expect(rows).toHaveLength(6);
  });

  it("threshold absent admits both breaching and non-breaching rows", () => {
    const snapshot = buildSnapshot();
    const rows = filterMetricRows(
      new URLSearchParams("department=distribution"),
      snapshot,
    );
    expect(rows).toHaveLength(8);
  });

  it("an unrecognised department narrows nothing", () => {
    const snapshot = buildSnapshot();
    const rows = filterMetricRows(
      new URLSearchParams("department=not-a-department"),
      snapshot,
    );
    expect(rows).toHaveLength(snapshot.points.length);
  });

  it("period narrows to the exact period only", () => {
    const snapshot = buildSnapshot();
    snapshot.points.push(point("revenue", "corporate", 100, 105, "2024-07"));
    const rows = filterMetricRows(
      new URLSearchParams("period=2024-07"),
      snapshot,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].period).toBe("2024-07");
  });

  /**
   * `?period=` (or `?period=%20`) must narrow NOTHING, the same rule
   * `department`/`top` already honour for a value they cannot use — not
   * "narrow to rows whose period is the empty string", which is every row at
   * once, silently. This failed before `normalizePeriodLever` (`./metric-rows`)
   * existed: `searchParams.get("period")` returned `""`, which is `!== null`,
   * so the `period !== null && point.period !== period` guard excluded every
   * point in the snapshot.
   */
  it("an empty period narrows nothing, the same as an absent one", () => {
    const snapshot = buildSnapshot();
    const rows = filterMetricRows(new URLSearchParams("period="), snapshot);
    expect(rows).toHaveLength(snapshot.points.length);
  });

  it("a whitespace-only period narrows nothing", () => {
    const snapshot = buildSnapshot();
    const rows = filterMetricRows(
      new URLSearchParams("period=%20%20"),
      snapshot,
    );
    expect(rows).toHaveLength(snapshot.points.length);
  });
});

describe("normalizePeriodLever", () => {
  it("passes a real period straight through", () => {
    expect(normalizePeriodLever("2024-06")).toBe("2024-06");
  });
  it("treats an empty or whitespace-only value as absent", () => {
    expect(normalizePeriodLever("")).toBeNull();
    expect(normalizePeriodLever("   ")).toBeNull();
  });
  it("treats null and undefined as absent", () => {
    expect(normalizePeriodLever(null)).toBeNull();
    expect(normalizePeriodLever(undefined)).toBeNull();
  });

  /**
   * THE TRIM MUST REACH THE RETURN VALUE. This function computed `raw.trim()`
   * for its blank test and then returned the UNTRIMMED `raw`, so
   * `?period=%202026-02` was honoured verbatim: no point's period carries a
   * leading space, so it narrowed every row away while tinting the period
   * control and adding a phantom, near-identical second option to the select —
   * the exact defect this function's own header claims to prevent, one
   * character over.
   */
  it("returns the TRIMMED period, not the padded raw", () => {
    expect(normalizePeriodLever(" 2026-02")).toBe("2026-02");
    expect(normalizePeriodLever("2026-02 ")).toBe("2026-02");
    expect(normalizePeriodLever("\t2024-06\n")).toBe("2024-06");
  });

  /**
   * SHAPE, NOT JUST BLANKNESS. `MetricPoint.period` is always "YYYY-MM"
   * (`data/types.ts`), so a value of any other shape can only ever match zero
   * rows — which is the same all-excluding filter a blank one used to be. An
   * unusable period narrows NOTHING.
   */
  it("rejects a value that is not a YYYY-MM month", () => {
    expect(normalizePeriodLever("q3")).toBeNull();
    expect(normalizePeriodLever("2024")).toBeNull();
    expect(normalizePeriodLever("2024-13")).toBeNull();
    expect(normalizePeriodLever("2024-00")).toBeNull();
    expect(normalizePeriodLever("2024-6")).toBeNull();
    expect(normalizePeriodLever("2024-06-01")).toBeNull();
  });

  /**
   * THE "any" SENTINEL, both sides. `tools.tsx`'s `navigateTo` requires every
   * lever and maps its `"any"` sentinel back to `undefined` before calling
   * `execNavTarget` — but `?period=any` typed straight into the address bar
   * (or emitted by anything that skips that mapping) reached this function as
   * a literal period, matched no row, and emptied the table under a tinted
   * control. "any" means "leave this lever alone" on BOTH sides of the URL.
   */
  it("treats the 'any' sentinel as no lever, whatever its case", () => {
    expect(normalizePeriodLever("any")).toBeNull();
    expect(normalizePeriodLever("ANY")).toBeNull();
    expect(normalizePeriodLever("Any")).toBeNull();
    expect(normalizePeriodLever("  any  ")).toBeNull();
  });
});

describe("filterMetricRows — unusable period levers narrow nothing", () => {
  it("honours a PADDED period as that period rather than as nothing", () => {
    const snapshot = buildSnapshot();
    snapshot.points.push(point("revenue", "corporate", 100, 105, "2024-07"));
    const rows = filterMetricRows(
      new URLSearchParams("period=%202024-06"),
      snapshot,
    );
    // Every fixture point except the 2024-07 one just pushed.
    expect(rows).toHaveLength(snapshot.points.length - 1);
    expect(rows.every((r) => r.period === "2024-06")).toBe(true);
  });

  it("treats ?period=any as no lever at all", () => {
    const snapshot = buildSnapshot();
    expect(
      filterMetricRows(new URLSearchParams("period=any"), snapshot),
    ).toHaveLength(snapshot.points.length);
    expect(
      filterMetricRows(new URLSearchParams("period=ANY"), snapshot),
    ).toHaveLength(snapshot.points.length);
  });

  it("treats a malformed period as no lever at all", () => {
    const snapshot = buildSnapshot();
    expect(
      filterMetricRows(new URLSearchParams("period=q3"), snapshot),
    ).toHaveLength(snapshot.points.length);
  });
});

describe("filterMetricRows — top-N is the ONLY thing that reorders", () => {
  /**
   * WITHOUT `top`, the rows come back in POINT ORDER, unsorted. This is the
   * other half of the top-N contract: the fixture's insertion order is
   * deliberately not its variance order, so a table that sorted
   * unconditionally would fail here, and one that never sorts fails the
   * top-N case above.
   */
  it("leaves rows in point order when top is unset", () => {
    const snapshot = buildSnapshot();
    const rows = filterMetricRows(
      new URLSearchParams("department=distribution&threshold=1"),
      snapshot,
    );
    expect(rows.map((r) => r.metricId)).toEqual([
      "opex",
      "dsoDays",
      "headcountCost",
      "burnRate",
      "revenue",
      "arAgingDays",
    ]);
  });

  it("leaves rows in point order when top is set to something unusable", () => {
    const snapshot = buildSnapshot();
    const rows = filterMetricRows(
      new URLSearchParams("department=distribution&threshold=1&top=abc"),
      snapshot,
    );
    expect(rows.map((r) => r.metricId)).toEqual([
      "opex",
      "dsoDays",
      "headcountCost",
      "burnRate",
      "revenue",
      "arAgingDays",
    ]);
  });

  /**
   * A NON-FINITE VARIANCE IS UNRANKABLE, NOT ENORMOUS. A point planned at
   * zero divides by zero: `Infinity` (or `NaN` when actual is zero too). The
   * comparator subtracted those magnitudes, so `Infinity` sorted FIRST — the
   * one row the table renders as "— n/a" led a list titled "top N by
   * variance" — and `NaN` made the comparator itself return `NaN`, which is
   * not an ordering at all and leaves the result up to the engine's sort.
   * Non-finite rows rank last, deterministically.
   */
  it("ranks non-finite variances last rather than first", () => {
    const snapshot = buildSnapshot();
    snapshot.points = [
      point("cash", "corporate", 0, 5), // Infinity
      point("ebitda", "corporate", 0, 0), // NaN
      point("opex", "corporate", 100, 109), // 0.09
      point("dsoDays", "corporate", 100, 150), // 0.50
      point("revenue", "corporate", 100, 130), // 0.30
    ];
    const rows = filterMetricRows(new URLSearchParams("top=3"), snapshot);
    expect(rows.map((r) => r.metricId)).toEqual(["dsoDays", "revenue", "opex"]);

    // And when the slice is wide enough to include them, they are at the END.
    const all = filterMetricRows(new URLSearchParams("top=5"), snapshot);
    expect(all.slice(0, 3).map((r) => r.metricId)).toEqual([
      "dsoDays",
      "revenue",
      "opex",
    ]);
    expect(
      all
        .slice(3)
        .map((r) => r.metricId)
        .sort(),
    ).toEqual(["cash", "ebitda"]);
  });
});

/**
 * ONE VOCABULARY, NOT TWO. The Metrics Explorer's `<select>` used to carry its
 * own hand-copied list of departments beside this one; the two could drift
 * silently, putting an option on screen that narrows to nothing (or hiding a
 * department the rows can actually be filtered by). The page now renders THIS
 * array, so there is nothing left to desync.
 */
describe("DEPARTMENT_VALUES", () => {
  it("is the exec skin's one department vocabulary", () => {
    expect(DEPARTMENT_VALUES).toEqual([
      "manufacturing",
      "distribution",
      "field-services",
      "corporate",
      "all",
    ]);
  });

  it("every value it advertises actually narrows the rows", () => {
    const snapshot = buildSnapshot();
    for (const department of DEPARTMENT_VALUES) {
      const rows = filterMetricRows(
        new URLSearchParams(`department=${department}`),
        snapshot,
      );
      expect(rows.every((r) => r.department === department)).toBe(true);
    }
    // …and the fixture proves at least three of them are non-empty, so the
    // assertion above is not vacuously true for the whole vocabulary.
    expect(
      filterMetricRows(
        new URLSearchParams("department=distribution"),
        snapshot,
      ),
    ).not.toHaveLength(0);
    expect(
      filterMetricRows(
        new URLSearchParams("department=manufacturing"),
        snapshot,
      ),
    ).not.toHaveLength(0);
    expect(
      filterMetricRows(new URLSearchParams("department=all"), snapshot),
    ).not.toHaveLength(0);
  });
});

/**
 * ASCENDING (CHRONOLOGICAL) — a deliberate divergence from `board-packs.tsx`,
 * whose filing form lists periods NEWEST first because filing a narrative is
 * almost always about the month that just closed. This explorer reads as a
 * timeline, so its axis runs forwards.
 */
describe("periodSelectOptions", () => {
  it("lists the snapshot's periods ascending, deduped", () => {
    expect(
      periodSelectOptions(["2024-07", "2024-06", "2024-07", "2024-05"], null),
    ).toEqual(["2024-05", "2024-06", "2024-07"]);
  });

  it("includes the active period even when the snapshot has no data for it", () => {
    expect(periodSelectOptions(["2024-06"], "2024-09")).toEqual([
      "2024-06",
      "2024-09",
    ]);
  });

  it("does not duplicate an active period the snapshot already carries", () => {
    expect(periodSelectOptions(["2024-06", "2024-07"], "2024-06")).toEqual([
      "2024-06",
      "2024-07",
    ]);
  });
});

describe("formatMetricValue", () => {
  it("formats each known unit the way the catalog renderers do", () => {
    expect(formatMetricValue("pct", 0.125)).toBe("12.5%");
    expect(formatMetricValue("months", 3)).toBe("3.0 mo");
    expect(formatMetricValue("days", 42)).toBe("42.0 d");
    expect(formatMetricValue("score", 7.25)).toBe("7.3");
    expect(formatMetricValue("usd", 1_200_000)).toContain("1.2M");
  });

  /**
   * FAIL LOUD, NOT BLANK. The switch had no `default`, so a unit this file
   * has no arm for returned `undefined` and React rendered an EMPTY cell —
   * a plan and an actual silently missing from a table whose whole job is to
   * show them. The raw number goes on screen and the mismatch is shouted at
   * the console.
   */
  it("renders the raw value and shouts when the unit is unknown", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(formatMetricValue("furlongs" as never, 12.5)).toBe("12.5");
    expect(formatMetricValue(undefined, 3)).toBe("3");
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

/**
 * THE READABLE CARRIES THE DISPLAY STRING BESIDE THE RAW NUMBER — the rule
 * keel's `deriveRegisterKpiTiles` states (`skins/keel/components/register-kpis.tsx`):
 * a readable holding a raw `0.6666…` gets quoted back on stage in a form that
 * disagrees with the screen. Variance is rendered as a signed PERCENTAGE here
 * while the readable published the bare fraction, so an assistant asked to
 * read a row out loud said "0.12" for a cell that says "+12.0%".
 */
describe("explorerReadableRows", () => {
  const ROW = {
    metricId: "opex" as MetricId,
    label: "Opex",
    department: "distribution" as const,
    period: "2024-06",
    plan: 100,
    actual: 112,
    variancePct: 0.12,
    breaching: true,
  };

  it("emits the on-screen variance string beside the raw fraction", () => {
    const [row] = explorerReadableRows([ROW]);
    expect(row.variancePct).toBe(0.12);
    expect(row.varianceDisplay).toBe("+12.0%");
  });

  it("emits the same 'n/a' the cell shows for a non-finite variance", () => {
    const [row] = explorerReadableRows([{ ...ROW, variancePct: NaN }]);
    expect(row.varianceDisplay).toBe("— n/a");
  });

  it("names the department the way the table does", () => {
    expect(explorerReadableRows([ROW])[0].department).toBe("Distribution");
    expect(
      explorerReadableRows([{ ...ROW, department: "all" }])[0].department,
    ).toBe("Company-wide");
  });
});

describe("nextLeverSearchParams", () => {
  const CURRENT = {
    period: null as string | null,
    department: null as "manufacturing" | "all" | null,
    threshold: false,
    top: null as number | null,
  };

  it("preserves a param outside the four levers untouched", () => {
    const base = new URLSearchParams("foo=bar&department=manufacturing");
    const next = nextLeverSearchParams(
      base,
      { ...CURRENT, department: "manufacturing" },
      { threshold: true },
    );
    expect(next.get("foo")).toBe("bar");
    expect(next.get("threshold")).toBe("1");
    expect(next.get("department")).toBe("manufacturing");
  });

  it("restates the VALIDATED department, dropping an unrecognised raw value, on a push that doesn't touch department", () => {
    // The raw query string carries an unrecognised department (as if the page
    // were reached with `?department=bogus`); `current.department` is what
    // the page itself already validated to `null` for that same value.
    const base = new URLSearchParams("department=bogus");
    const next = nextLeverSearchParams(
      base,
      { ...CURRENT, department: null },
      { threshold: true },
    );
    expect(next.get("department")).toBeNull();
    expect(next.get("threshold")).toBe("1");
  });

  it("still allows an explicit department override to set a new value", () => {
    const base = new URLSearchParams("department=bogus");
    const next = nextLeverSearchParams(
      base,
      { ...CURRENT, department: null },
      { department: "manufacturing" },
    );
    expect(next.get("department")).toBe("manufacturing");
  });

  it("clears a lever when the override is explicitly null", () => {
    const base = new URLSearchParams("period=2024-06&top=10");
    const next = nextLeverSearchParams(
      base,
      { ...CURRENT, period: "2024-06", top: 10 },
      { period: null },
    );
    expect(next.get("period")).toBeNull();
    // `top` was not touched by this override, so it restates its current
    // (parsed) value rather than vanishing alongside `period`.
    expect(next.get("top")).toBe("10");
  });

  it("leaves an untouched lever exactly as it currently is when no key names it", () => {
    const base = new URLSearchParams("top=25");
    const next = nextLeverSearchParams(base, { ...CURRENT, top: 25 }, {});
    expect(next.get("top")).toBe("25");
  });

  /**
   * THE CLEARING HALF OF EVERY LEVER. `threshold` and `top` each had their
   * SETTING branch covered and their clearing branch untested — the "Breaches
   * only" button's second click, and the Show select's "All" option, are the
   * only ways a user turns those two off, and neither had an assertion.
   */
  it("clears threshold when the override turns it off", () => {
    const base = new URLSearchParams("threshold=1&department=manufacturing");
    const next = nextLeverSearchParams(
      base,
      { ...CURRENT, threshold: true, department: "manufacturing" },
      { threshold: false },
    );
    expect(next.get("threshold")).toBeNull();
    // The other three levers survive the clear.
    expect(next.get("department")).toBe("manufacturing");
  });

  it("clears top when the override is null, leaving the other levers set", () => {
    const base = new URLSearchParams("top=10&threshold=1");
    const next = nextLeverSearchParams(
      base,
      { ...CURRENT, top: 10, threshold: true },
      { top: null },
    );
    expect(next.get("top")).toBeNull();
    expect(next.get("threshold")).toBe("1");
  });

  it("sets top from an override, replacing the current value", () => {
    const base = new URLSearchParams("top=10");
    const next = nextLeverSearchParams(
      base,
      { ...CURRENT, top: 10 },
      {
        top: 5,
      },
    );
    expect(next.get("top")).toBe("5");
  });

  it("sets threshold from an override that turns it on", () => {
    const next = nextLeverSearchParams(new URLSearchParams(), CURRENT, {
      threshold: true,
    });
    expect(next.get("threshold")).toBe("1");
  });
});
