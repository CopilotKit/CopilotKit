import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  DEPARTMENT_VALUES,
  filterMetricRows,
  normalizeDepartmentLever,
  normalizeMetricLever,
  normalizePeriodLever,
  parseTopLever,
} from "./metric-rows";
import {
  MetricsExplorerPage,
  READABLE_ROW_LIMIT,
  explorerReadableRows,
  explorerReadableValue,
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
 * The page's own DOM harness, mirroring commerce's `orders.test.tsx` (~line
 * 27): the levers are read off `useSearchParams`, so drive that
 * deterministically, record what the readable is handed rather than dropping
 * it, and capture the router calls so a push can be told from a replace.
 */
const query = { value: "" };
const routerCalls: { method: "push" | "replace"; href: string }[] = [];

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: (href: string) => routerCalls.push({ method: "push", href }),
    replace: (href: string) => routerCalls.push({ method: "replace", href }),
  }),
  useSearchParams: () => new URLSearchParams(query.value),
}));

const readable = { value: "" };
vi.mock("@copilotkit/react-core/v2", () => ({
  useAgentContext: ({ value }: { value: string }) => {
    readable.value = value;
  },
}));

// The page reads its snapshot off the ledger context; serve the same synthetic
// snapshot the pure-function suites below use, read lazily at render.
const ledgerSnapshot: { value: LedgerSnapshot | null } = { value: null };
vi.mock("../data/ledger-context", () => ({
  useExecLedger: () => ({ snapshot: ledgerSnapshot.value }),
}));

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

  /**
   * ONCE PER UNIT, NOT ONCE PER CELL. This ran inside the table's row map, so
   * a single unwired unit shouted twice per row (plan and actual) on EVERY
   * render — the seed's unlevered table is 528 rows, i.e. a thousand identical
   * lines per paint, which buries the very message it exists to deliver along
   * with every other log the demo is producing. The gap is stated once and
   * then remembered.
   *
   * Each test in this describe uses a unit name of its own, because the set of
   * already-reported units is module-level and lives for the process.
   */
  it("shouts once per unknown unit, however many values carry it", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(formatMetricValue("parsecs" as never, 1)).toBe("1");
    expect(formatMetricValue("parsecs" as never, 2)).toBe("2");
    expect(formatMetricValue("parsecs" as never, 3)).toBe("3");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0][0])).toContain("parsecs");
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

/**
 * THE TRIM, THE OTHER LEVER. `normalizePeriodLever`'s own header calls a
 * trim that never reached the return value a past defect — and its sibling
 * here had no trim at all, so `?department=%20distribution` (a copied link, a
 * hand-typed URL, an agent that padded its argument) failed the membership
 * test, resolved to `null`, and narrowed NOTHING while the operator was
 * looking at a department in the address bar. Unusable-narrows-nothing is the
 * right rule for a department that does not exist; a padded one exists.
 */
describe("normalizeDepartmentLever", () => {
  it("passes a known department straight through", () => {
    expect(normalizeDepartmentLever("distribution")).toBe("distribution");
    expect(normalizeDepartmentLever("all")).toBe("all");
  });

  it("returns the TRIMMED department, not the padded raw", () => {
    expect(normalizeDepartmentLever(" distribution")).toBe("distribution");
    expect(normalizeDepartmentLever("corporate ")).toBe("corporate");
    expect(normalizeDepartmentLever("\tfield-services\n")).toBe(
      "field-services",
    );
  });

  it("treats an unrecognised value, the 'any' sentinel and a blank as absent", () => {
    expect(normalizeDepartmentLever("not-a-department")).toBeNull();
    expect(normalizeDepartmentLever("any")).toBeNull();
    expect(normalizeDepartmentLever("  ")).toBeNull();
    expect(normalizeDepartmentLever(null)).toBeNull();
    expect(normalizeDepartmentLever(undefined)).toBeNull();
  });
});

/**
 * THE `metric` LEVER — the one the CEO dashboard's exception cards drill in
 * with. Each card names a metric AND a department ("Opex · Distribution"), but
 * the drill-in carried only the department, so clicking it landed the reader on
 * every metric that department has, with no trace of the row they clicked. The
 * lever follows this module's one rule: a metric this snapshot has no def for
 * narrows NOTHING rather than emptying the table.
 */
describe("normalizeMetricLever", () => {
  const KNOWN = new Set(["opex", "revenue"]);

  it("passes a known metric straight through, trimmed", () => {
    expect(normalizeMetricLever("opex", KNOWN)).toBe("opex");
    expect(normalizeMetricLever("  revenue  ", KNOWN)).toBe("revenue");
  });

  it("treats an unknown metric, the 'any' sentinel and a blank as absent", () => {
    expect(normalizeMetricLever("not-a-metric", KNOWN)).toBeNull();
    expect(normalizeMetricLever("any", KNOWN)).toBeNull();
    expect(normalizeMetricLever("ANY", KNOWN)).toBeNull();
    expect(normalizeMetricLever("", KNOWN)).toBeNull();
    expect(normalizeMetricLever(null, KNOWN)).toBeNull();
    expect(normalizeMetricLever(undefined, KNOWN)).toBeNull();
  });
});

describe("filterMetricRows — the metric lever", () => {
  it("narrows to the named metric only", () => {
    const snapshot = buildSnapshot();
    const rows = filterMetricRows(new URLSearchParams("metric=opex"), snapshot);
    expect(rows).toHaveLength(1);
    expect(rows[0].metricId).toBe("opex");
  });

  it("composes with the department lever", () => {
    const snapshot = buildSnapshot();
    const rows = filterMetricRows(
      new URLSearchParams("metric=revenue&department=manufacturing"),
      snapshot,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].department).toBe("manufacturing");
  });

  it("narrows nothing when the metric is unknown to this snapshot", () => {
    const snapshot = buildSnapshot();
    expect(
      filterMetricRows(new URLSearchParams("metric=not-a-metric"), snapshot),
    ).toHaveLength(snapshot.points.length);
  });

  it("honours a PADDED metric as that metric rather than as nothing", () => {
    const snapshot = buildSnapshot();
    const rows = filterMetricRows(
      new URLSearchParams("metric=%20opex"),
      snapshot,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].metricId).toBe("opex");
  });
});

/**
 * FAIL LOUD ON A DEF-LESS POINT. A point whose metric has no def is genuinely
 * unrenderable — no label, no threshold to breach against — so dropping it is
 * right. Dropping it in SILENCE is not: the table then shows a row count
 * nothing on the ledger explains, and the seed carries 500-odd points, so a
 * def deleted in a refactor takes 24 rows off the screen with no trace
 * anywhere. The drop is announced once per metric id.
 */
describe("filterMetricRows — a def-less point is dropped LOUDLY", () => {
  it("shouts the metric id it dropped", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const snapshot = buildSnapshot();
    snapshot.points.push(point("orphanRows" as MetricId, "corporate", 100, 90));

    const rows = filterMetricRows(new URLSearchParams(), snapshot);

    expect(rows.some((r) => r.metricId === ("orphanRows" as MetricId))).toBe(
      false,
    );
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0][0])).toContain("orphanRows");
  });

  it("shouts ONCE per metric id, not once per point", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const snapshot = buildSnapshot();
    for (const period of ["2024-04", "2024-05", "2024-06"]) {
      snapshot.points.push(
        point("orphanOnce" as MetricId, "corporate", 100, 90, period),
      );
    }

    filterMetricRows(new URLSearchParams(), snapshot);
    filterMetricRows(new URLSearchParams(), snapshot);

    expect(spy).toHaveBeenCalledTimes(1);
  });
});

/**
 * THE READABLE IS BOUNDED, AND SAYS SO.
 *
 * The unlevered Metrics Explorer renders every point the ledger carries — the
 * real seed is 528 of them — and the readable published all of them, JSON, on
 * EVERY turn: ~100KB of context for a page whose interesting content is the
 * lever state and the top of the table. Commerce's `orders.tsx` publishes its
 * `visible` rows unbounded because its whole book is ~28 orders; that is the
 * precedent, and it does not survive a 528-row table.
 *
 * The cap is honest rather than silent: `showingCount` still reports what is
 * on screen, and `rowsTruncated` says the `rows` array is a prefix of it. A
 * readable that quietly published 25 rows while the screen showed 528 would be
 * the same lie as one that published a filtered count for an unfiltered view.
 */
describe("explorerReadableValue", () => {
  const NO_LEVERS = {
    period: null,
    department: null,
    metric: null,
    breachesOnly: false,
    top: null,
  };

  /** `n` synthetic rows — more than the cap, to exercise the truncation. */
  function manyRows(n: number): ReturnType<typeof filterMetricRows> {
    const snapshot = buildSnapshot();
    snapshot.points = Array.from({ length: n }, (_, i) =>
      point("opex", "corporate", 100, 100 + i, `20${10 + (i % 80)}-06`),
    );
    return filterMetricRows(new URLSearchParams(), snapshot);
  }

  it("bounds the published rows for an unlevered page while reporting the real on-screen count", () => {
    const rows = manyRows(READABLE_ROW_LIMIT + 40);
    const value = explorerReadableValue(NO_LEVERS, rows, rows);

    expect(rows.length).toBeGreaterThan(READABLE_ROW_LIMIT);
    expect(value.rows.length).toBe(READABLE_ROW_LIMIT);
    expect(value.showingCount).toBe(rows.length);
    expect(value.matchingCount).toBe(rows.length);
    expect(value.rowsTruncated).toBe(true);
  });

  it("publishes the whole set, untruncated, once the levers bring it under the cap", () => {
    const rows = manyRows(4);
    const value = explorerReadableValue(NO_LEVERS, rows, rows);

    expect(value.rows.length).toBe(4);
    expect(value.rowsTruncated).toBe(false);
  });

  it("publishes the rows in the order the table shows them", () => {
    const rows = manyRows(READABLE_ROW_LIMIT + 5);
    const value = explorerReadableValue(NO_LEVERS, rows, rows);

    expect(value.rows.map((r) => r.period)).toEqual(
      rows.slice(0, READABLE_ROW_LIMIT).map((r) => r.period),
    );
  });

  it("names exactly the levers that are set", () => {
    const rows = manyRows(2);
    expect(explorerReadableValue(NO_LEVERS, rows, rows).activeLevers).toEqual(
      [],
    );
    expect(
      explorerReadableValue(
        {
          period: "2024-06",
          department: "all",
          metric: "opex" as MetricId,
          breachesOnly: true,
          top: 5,
        },
        rows,
        rows,
      ).activeLevers,
    ).toEqual(["period", "department", "metric", "threshold", "top"]);
  });
});

/**
 * THE PAGE ITSELF — the three things only a mounted render can show: which
 * history entry a lever push writes, whether the toggle announces its own
 * state, and whether the `top` select claims a provenance it cannot know.
 */
describe("MetricsExplorerPage", () => {
  function renderAt(search: string) {
    cleanup();
    routerCalls.length = 0;
    query.value = search;
    ledgerSnapshot.value = buildSnapshot();
    render(<MetricsExplorerPage />);
  }

  afterEach(() => cleanup());

  /**
   * A LEVER PUSH REPLACES, IT DOES NOT STACK. Every control on this page
   * writes the same four-plus-one levers back into the query string of the
   * page already on screen. With `router.push` each click left a history
   * entry, so a presenter who set three levers had to press Back three times
   * to leave the Metrics Explorer — and the agent's own `navigateTo` sequences
   * buried the previous page under a pile of near-identical URLs.
   */
  it("replaces the history entry on a lever write rather than pushing a new one", () => {
    renderAt("");
    fireEvent.click(screen.getByRole("button", { name: "Breaches only" }));

    expect(routerCalls).toHaveLength(1);
    expect(routerCalls[0].method).toBe("replace");
    expect(routerCalls[0].href).toContain("threshold=1");
  });

  /**
   * THE TOGGLE SAYS WHETHER IT IS ON. "Breaches only" is a `<button>` that
   * tints when active, which is invisible to a screen reader and to any test
   * that is not sampling class names. `aria-pressed` is the toggle's actual
   * state, in the accessibility tree.
   */
  it("announces the breaches-only toggle's state with aria-pressed", () => {
    renderAt("");
    expect(
      screen
        .getByRole("button", { name: "Breaches only" })
        .getAttribute("aria-pressed"),
    ).toBe("false");

    renderAt("threshold=1");
    expect(
      screen
        .getByRole("button", { name: "Breaches only" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  /**
   * NO PROVENANCE THIS PAGE CANNOT KNOW. An off-vocabulary `top` was labelled
   * "7 (from chat)", but the query string carries no author: `?top=7` typed
   * into the address bar, arriving on a shared link, or set by the agent are
   * the same URL. The option says what it is worth, and nothing about where it
   * came from.
   */
  it("labels an off-vocabulary top without claiming the agent set it", () => {
    renderAt("top=7");
    const option = screen.getByRole("option", {
      name: /7/,
    }) as HTMLOptionElement;
    expect(option.value).toBe("7");
    expect(document.body.textContent).not.toContain("from chat");
  });

  /**
   * THE `metric` LEVER IS ON SCREEN. A lever that narrows the table without a
   * control showing it is a filtered view the reader cannot account for — the
   * exact failure the department `<select>`'s own comment describes.
   */
  it("shows the active metric lever in its own control", () => {
    renderAt("metric=opex");
    const select = screen.getByRole("combobox", {
      name: "Metric",
    }) as HTMLSelectElement;
    expect(select.value).toBe("opex");
    expect(document.querySelectorAll("tbody tr")).toHaveLength(1);
  });
});

describe("nextLeverSearchParams", () => {
  const CURRENT = {
    period: null as string | null,
    department: null as "manufacturing" | "all" | null,
    metric: null as MetricId | null,
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

  it("restates the VALIDATED metric on a push that doesn't touch it, and clears it on an explicit null", () => {
    const base = new URLSearchParams("metric=not-a-metric");
    const kept = nextLeverSearchParams(
      base,
      { ...CURRENT, metric: "opex" as MetricId },
      { threshold: true },
    );
    expect(kept.get("metric")).toBe("opex");

    const cleared = nextLeverSearchParams(
      base,
      { ...CURRENT, metric: "opex" as MetricId },
      { metric: null },
    );
    expect(cleared.get("metric")).toBeNull();
  });
});
