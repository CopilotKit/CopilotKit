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

function metricSeries(
  metricId: MetricId,
  // `"all"` is a value of `MetricPoint.department`, not a department — the
  // parameter schema below admits it (and its `.describe()` tells the model to
  // pass it for the company-wide series), so the annotation has to as well.
  // Typed as `Department` alone, the one filter that matters for a
  // company-wide request was outside the type it was checked against.
  department?: Department | "all",
  months?: number,
): SafeMetricPoint[] {
  let rows = snapshot.points.filter((p) => p.metricId === metricId);
  if (department) rows = rows.filter((p) => p.department === department);
  rows = [...rows].sort((a, b) =>
    a.period < b.period ? -1 : a.period > b.period ? 1 : 0,
  );
  if (months) {
    const keep = new Set(
      [...new Set(rows.map((r) => r.period))].sort().slice(-months),
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
      metricId: z.enum([
        "revenue",
        "growthQoQ",
        "growthYoY",
        "operatingMargin",
        "ebitda",
        "cash",
        "runwayMonths",
        "nps",
        "burnRate",
        "arAgingDays",
        "dsoDays",
        "opex",
        "headcountCost",
        "forecastAccuracy",
      ]),
      department: z
        .enum([
          "manufacturing",
          "distribution",
          "field-services",
          "corporate",
          "all",
        ])
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
