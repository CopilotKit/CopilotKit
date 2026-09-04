import { z } from "zod";
import type { SandboxFunction } from "@copilotkit/react-core/v2";
import type {
  Department,
  Exception,
  LedgerSnapshot,
  MetricId,
  MetricPoint,
} from "@/skins/exec/data/types";

/**
 * The single source the sandbox reads. Holds the FULL ledger snapshot (mirrors
 * keel's `KeelLedger` pattern used by `store.ts`); every handler projects to a
 * DTO at the boundary so no raw domain object ever crosses into the iframe's
 * LLM-authored JS. <SandboxDataSync/> keeps this in sync with the app's live view.
 */
let snapshot: LedgerSnapshot = {
  metricDefs: [],
  points: [],
  initiatives: [],
  narratives: [],
  dashboards: {
    ceo: { id: "ceo", title: "", blocks: [] },
    cfo: { id: "cfo", title: "", blocks: [] },
  },
  packs: [],
  exceptions: [],
};

/**
 * Replace the snapshot the handlers read. Takes ownership of `next` (and its
 * arrays) by reference — it does not clone. The sole caller is <SandboxDataSync/>,
 * which passes React state treated as immutable, so the reference is never mutated
 * in place after handoff.
 */
export function setSandboxSnapshot(next: LedgerSnapshot): void {
  snapshot = next;
}

// ── Projection DTOs (allowlist — no raw domain objects cross the boundary) ──
type SafeMetricPoint = {
  metricId: MetricId;
  period: string;
  department: Department | "all";
  plan: number;
  actual: number;
  forecast: number;
};
type SafeException = {
  metricId: MetricId;
  period: string;
  department: Department | "all";
  variancePct: number;
  explained: boolean;
};

const toSafeMetricPoint = (p: MetricPoint): SafeMetricPoint => ({
  metricId: p.metricId,
  period: p.period,
  department: p.department,
  plan: p.plan,
  actual: p.actual,
  forecast: p.forecast,
});
const toSafeException = (e: Exception): SafeException => ({
  metricId: e.metricId,
  period: e.period,
  department: e.department,
  variancePct: e.variancePct,
  explained: e.explained,
});

/**
 * THE VOCABULARY, CHECKED BY THE COMPILER. Zod schemas cannot import a TS type
 * at runtime, so the enums below have to restate the `MetricId` and
 * `Department` unions — but restating them BY EYE is how a metric added to
 * `./data/types.ts` quietly stops being reachable from the sandbox. The
 * `satisfies` clauses fail both ways (a missing key, and a key the union does
 * not have), exactly as `src/app/api/exec/v1/narratives/route.ts` does for the
 * same reason.
 *
 * They double as the fail-loud allowlist below: `Object.hasOwn` against these
 * is what tells an unknown id apart from a metric with no rows yet.
 */
const METRIC_IDS = {
  revenue: true,
  growthQoQ: true,
  growthYoY: true,
  operatingMargin: true,
  ebitda: true,
  cash: true,
  runwayMonths: true,
  nps: true,
  burnRate: true,
  arAgingDays: true,
  dsoDays: true,
  opex: true,
  headcountCost: true,
  forecastAccuracy: true,
} as const satisfies Record<MetricId, true>;

const DEPARTMENTS = {
  manufacturing: true,
  distribution: true,
  "field-services": true,
  corporate: true,
} as const satisfies Record<Department, true>;

/**
 * `"all"` is a value of `MetricPoint.department`, not a department, so it is
 * added HERE rather than to the union above — the schema admits it and its
 * `.describe()` tells the model to pass it for the company-wide series.
 */
const DEPARTMENT_FILTERS = { ...DEPARTMENTS, all: true } as const;

/**
 * How many trailing periods a `months` argument narrows to, or `null` for
 * "don't narrow — return the full history".
 *
 * REIMPLEMENTS `periodWindow` FROM `./data/store.ts`, which is that module's
 * private helper and the contract this getter has to match: only a positive,
 * finite number narrows. A plain `if (months)` — what this used to be —
 * mishandles two of the three reachable bad values: 0 is falsy, so it silently
 * meant "the full history" instead of an empty window, and -3 reached
 * `slice(-(-3))` === `slice(3)`, the OLDEST periods, an INVERTED window
 * answering a request for the newest three. Full history is the honest answer
 * for all of them — the caller asked for no usable narrowing, and returning
 * everything is visibly wrong on screen where returning the wrong END of the
 * series is not. A fraction floors, so `2.7` never reaches into a third period.
 *
 * `months` reaches this getter from LLM-authored JS inside the sandbox iframe,
 * which is the least constrained caller in the app: the zod schema on the tool
 * guards the CALL, not this handler.
 */
function periodWindow(months: number | undefined): number | null {
  if (months === undefined) return null;
  if (!Number.isFinite(months) || months <= 0) return null;
  return Math.floor(months);
}

function metricSeries(
  metricId: MetricId,
  // `"all"` is admitted for the reason `DEPARTMENT_FILTERS` records. Typed as
  // `Department` alone, the one filter that matters for a company-wide request
  // was outside the type it was checked against.
  department?: Department | "all",
  months?: number,
): SafeMetricPoint[] {
  // FAIL LOUD ON A VOCABULARY MISS. An id nothing knows filters to zero rows,
  // which is byte-identical to "this metric has no data yet" — so a model that
  // invents `revenue_total` gets a legitimate-looking empty series and draws an
  // empty chart nobody can account for. The empty result stands (there is
  // nothing to return), but the console names what was asked for.
  if (!Object.hasOwn(METRIC_IDS, metricId)) {
    console.error(
      `[exec/sandbox] getMetricSeries: unknown metricId ${JSON.stringify(metricId)} — ` +
        `returning an empty series. Known ids: ${Object.keys(METRIC_IDS).join(", ")}`,
    );
    return [];
  }
  if (
    department !== undefined &&
    !Object.hasOwn(DEPARTMENT_FILTERS, department)
  ) {
    console.error(
      `[exec/sandbox] getMetricSeries: unknown department ${JSON.stringify(department)} — ` +
        `returning an empty series. Known departments: ${Object.keys(DEPARTMENT_FILTERS).join(", ")}`,
    );
    return [];
  }

  let rows = snapshot.points.filter((p) => p.metricId === metricId);
  if (department) rows = rows.filter((p) => p.department === department);
  rows = [...rows].sort((a, b) =>
    a.period < b.period ? -1 : a.period > b.period ? 1 : 0,
  );
  const window = periodWindow(months);
  if (window !== null) {
    const keep = new Set(
      [...new Set(rows.map((r) => r.period))].sort().slice(-window),
    );
    rows = rows.filter((r) => keep.has(r.period));
  }
  return rows.map(toSafeMetricPoint);
}

/**
 * Stable module-scope array — safe to hand straight to the provider. The
 * handlers close over the mutable module snapshot, so the array identity never
 * changes (avoids per-render re-registration + dev-console warnings from
 * useStableArrayProp) while the DATA stays live.
 */
export const sandboxFunctions: SandboxFunction[] = [
  {
    name: "getMetricSeries",
    description:
      "Return the monthly plan/actual/forecast series for a metric (real app data). " +
      "Optional `department` narrows to one department's series (metrics without " +
      'per-department data only have an "all" series). Optional `months` limits ' +
      "the result to the most recent N months.",
    parameters: z.object({
      // Derived from the compiler-checked records above, so the schema cannot
      // drift from `MetricId`/`Department` the way a second hand-written copy
      // of each union did.
      metricId: z.enum(Object.keys(METRIC_IDS) as [MetricId, ...MetricId[]]),
      department: z
        .enum(
          Object.keys(DEPARTMENT_FILTERS) as [
            Department | "all",
            ...Array<Department | "all">,
          ],
        )
        .optional()
        .describe(
          'Omitting `department` returns every series for the metric; pass "all" for the company-wide series.',
        ),
      months: z.number().int().positive().optional(),
    }),
    handler: async ({
      metricId,
      department,
      months,
    }: {
      metricId: MetricId;
      department?: Department | "all";
      months?: number;
    }) => metricSeries(metricId, department, months),
  },
  {
    name: "getExceptions",
    description:
      "Return the current variance exceptions — real app data. Each includes " +
      "`explained` (whether a narrative has been filed for its metric/period).",
    parameters: z.object({}),
    handler: async () => snapshot.exceptions.map(toSafeException),
  },
];
