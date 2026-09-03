import { z } from "zod";

export const CATALOG_ID = "https://cpk-a2ui.local/catalogs/exec/v1";

const childrenRef = z.array(z.string());
const stringOrPath = z.union([z.string(), z.object({ path: z.string() })]);

// Zod schemas can't import TS types at runtime, so these mirror the literal
// unions declared in ../data/types.ts by hand — keep them in sync.
const metricId = z.enum([
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
]);
const department = z.enum([
  "manufacturing",
  "distribution",
  "field-services",
  "corporate",
  "all",
]);
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
