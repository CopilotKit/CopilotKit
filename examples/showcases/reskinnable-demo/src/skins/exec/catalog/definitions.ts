import { z } from "zod";
import type { Department, MetricId } from "../data/types";

export const CATALOG_ID = "https://cpk-a2ui.local/catalogs/exec/v1";

const childrenRef = z.array(z.string());
const stringOrPath = z.union([z.string(), z.object({ path: z.string() })]);

/**
 * THE VOCABULARY, CHECKED BY THE COMPILER. Zod schemas can't import a TS type
 * at runtime, so this catalog has to restate the `MetricId` and `Department`
 * unions from ../data/types.ts — but restating them BY EYE is how a metric
 * added to that file quietly stops being bindable by any block the agent can
 * emit. `as const satisfies Record<MetricId, true>` fails BOTH ways (a key the
 * union has and this object doesn't, and a key the union doesn't have), so the
 * drift is a typecheck error rather than a component prop that silently
 * refuses a real metric.
 *
 * Same guard, same reason, as `../sandbox-functions.ts` and
 * `src/app/api/exec/v1/narratives/route.ts`. `data/vocabulary-parity.test.ts`
 * pins all four restatements against each other at runtime, because
 * `satisfies` only checks each copy against the union — never the copies
 * against the seed that has to hold rows for them.
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
 * added HERE rather than to the guarded record above — exactly as
 * `../sandbox-functions.ts` does it.
 */
const DEPARTMENT_FILTERS = { ...DEPARTMENTS, all: true } as const;

const metricId = z.enum(Object.keys(METRIC_IDS) as [MetricId, ...MetricId[]]);
const department = z.enum(
  Object.keys(DEPARTMENT_FILTERS) as [
    Department | "all",
    ...Array<Department | "all">,
  ],
);
const compare = z.enum(["plan", "forecast"]);
const audience = z.enum(["ceo", "cfo", "both"]);

export const definitions = {
  Stack: {
    description:
      "Vertical layout. Children stack top→bottom. The default page/section container.",
    props: z.object({
      children: childrenRef,
      gap: z.enum(["sm", "md", "lg", "xl"]).optional(),
    }),
  },
  Heading: {
    description:
      "The dashboard title — a LABEL ONLY. Use once at the top. Do NOT embed " +
      "figures, amounts, percentages, or trend claims (e.g. NOT 'Revenue up 12%') " +
      "— all quantitative content comes from MetricTile/TrendLine/VarianceBar.",
    props: z.object({ text: stringOrPath }),
  },
  /**
   * UNREACHABLE TODAY, deliberately kept. Every component in this app is
   * emitted by `buildBlockOps` (`../blocks/build-block-ops.ts`), which builds
   * `Stack` + `Heading` + one kind component (+ `AddToDashboard`) — nothing
   * emits a `Text`. It stays as the catalog's neutral-caption primitive (and
   * as the sibling `Heading` uses it, the label-only contract is stated in
   * one place for both), but no seed, tool or agent path can reach it, so a
   * change here changes nothing on screen until a block kind renders prose.
   */
  Text: {
    description:
      "A short NEUTRAL caption or section label (e.g. 'Board pack', " +
      "'This quarter'). Label-only: do NOT state figures, amounts, percentages, " +
      "deltas, or trend claims — every quantitative claim must come from " +
      "MetricTile/TrendLine/VarianceBar/InitiativeTable/ExceptionList, which " +
      "bind live data on the client. Use tone='muted' for secondary captions.",
    props: z.object({
      text: stringOrPath,
      tone: z.enum(["default", "muted"]).optional(),
    }),
  },
  MetricTile: {
    description:
      "A single KPI tile. `metricId` selects which live metric to bind — data " +
      "binds live on the client, do NOT pass numbers. `department` scopes the " +
      "figure to one department (only meaningful for per-department metrics: " +
      "'opex', 'headcountCost'; defaults to company-wide/'all' otherwise). " +
      "`compare` picks what the delta is measured against: 'plan' or 'forecast'.",
    props: z.object({
      metricId,
      department: department.optional(),
      compare: compare.optional(),
    }),
  },
  TrendLine: {
    description:
      "A live line chart of one metric over time. `metricId` selects which " +
      "metric to bind — data binds live on the client, do NOT pass numbers. " +
      "`department` scopes the series to one department (only meaningful for " +
      "per-department metrics: 'opex', 'headcountCost'). `months` is a QUERY " +
      "PARAMETER — the trailing window size in months (e.g. 12), NOT a data " +
      "value — it selects how much history to fetch, defaulting to 12.",
    props: z.object({
      metricId,
      department: department.optional(),
      months: z.number().int().positive().optional(),
    }),
  },
  VarianceBar: {
    description:
      "A live bar comparing actual vs plan/forecast for one metric. `metricId` " +
      "selects which metric to bind — data binds live on the client, do NOT " +
      "pass numbers. Only valid for per-department metrics ('opex', " +
      "'headcountCost'); do not use for company-wide-only metrics.",
    props: z.object({ metricId }),
  },
  InitiativeTable: {
    description:
      "A live table of initiatives (owner, status, note). Takes no props — " +
      "data binds live on the client, do NOT pass numbers or rows.",
    props: z.object({}),
  },
  /**
   * `audience` is NOT reachable from a pinned block today, by design.
   * `BlockSpec` (`../data/types.ts`) carries no audience field, so
   * `buildKindComponent` emits `ExceptionList` with no props and every
   * on-dashboard list runs at the default, "both" — an exceptionList block is
   * the ALL-metrics surface, which is also how `store.ts`'s publish gate reads
   * it (`referencedMetrics` → `includesAll`). The prop is honoured by the
   * renderer and the seeded audiences are meaningful (`../data/seed.ts`), so
   * it is live the moment a spec carries an audience; until then the CEO
   * page's fixed strip does its own company-wide narrowing in the page
   * (`../pages/ceo-dashboard.tsx`), and the two agree row for row.
   */
  ExceptionList: {
    description:
      "A live list of the latest period's metric variance exceptions, each " +
      "tagged explained or unexplained. `audience` filters which exceptions " +
      "show: 'ceo', 'cfo', or 'both' " +
      "(defaults to 'both'). Data is bound on the client — do NOT pass " +
      "numbers or rows.",
    props: z.object({ audience: audience.optional() }),
  },
  AddToDashboard: {
    description:
      "A pin control that adds the enclosing block to the dashboard. " +
      "`blockId` is the id of the block to pin — a reference, not data.",
    props: z.object({ blockId: z.string() }),
  },
};

export type Definitions = typeof definitions;
