import { z } from "zod";

export const CATALOG_ID = "https://cpk-a2ui.local/catalogs/banking/v1";

const childRef = z.string();
const childrenRef = z.array(z.string());
const stringOrPath = z.union([z.string(), z.object({ path: z.string() })]);

export const definitions = {
  Stack: {
    description:
      "Vertical layout. Children stack top→bottom. The default page/section container.",
    props: z.object({
      children: childrenRef,
      gap: z.enum(["sm", "md", "lg", "xl"]).optional(),
    }),
  },
  Row: {
    description:
      "Horizontal layout; wraps on small screens. Use for metric rows or badge groups.",
    props: z.object({
      children: childrenRef,
      gap: z.enum(["sm", "md", "lg"]).optional(),
    }),
  },
  Grid: {
    description:
      "Responsive grid. Use for a row of StatCards or a pair of charts.",
    props: z.object({
      children: childrenRef,
      columns: z.number().int().min(1).max(4).optional(),
    }),
  },
  Section: {
    description:
      "Titled section grouping a region of the report (e.g. 'Spend overview').",
    props: z.object({ title: z.string(), child: childRef }),
  },
  Heading: {
    description:
      "The report title — a LABEL ONLY. Use once at the top. Do NOT embed " +
      "figures, amounts, percentages, or trend claims (e.g. NOT 'Spend up 12%') " +
      "— all quantitative content comes from StatCard/Chart.",
    props: z.object({ text: stringOrPath }),
  },
  Text: {
    description:
      "A short NEUTRAL caption or section label (e.g. 'Spend overview', " +
      "'This quarter'). Label-only: do NOT state figures, amounts, percentages, " +
      "deltas, or trend claims — every quantitative claim must come from " +
      "StatCard/Chart/Transactions, which bind live client data. Use " +
      "tone='muted' for secondary captions.",
    props: z.object({
      text: stringOrPath,
      tone: z.enum(["default", "muted"]).optional(),
    }),
  },
  StatCard: {
    description:
      "A single KPI. `metric` selects a live figure computed on the client: " +
      "'totalSpend' (sum of approved spend), 'pendingCount' (transactions awaiting " +
      "approval), 'overLimitCount' (pending charges over their policy limit), " +
      "'policyCount' (number of expense policies). Provide `label` for the caption.",
    props: z.object({
      metric: z.enum([
        "totalSpend",
        "pendingCount",
        "overLimitCount",
        "policyCount",
      ]),
      label: stringOrPath,
    }),
  },
  Chart: {
    description:
      "A live banking chart. `kind` selects which: 'spendingTrend' (spend over time), " +
      "'budgetUsage' (spent vs limit per policy), 'spendBreakdown' (donut of spend by " +
      "team/policy), 'incomeVsExpenses' (income vs expenses + net). Data is bound on " +
      "the client — do NOT pass numbers.",
    props: z.object({
      kind: z.enum([
        "spendingTrend",
        "budgetUsage",
        "spendBreakdown",
        "incomeVsExpenses",
      ]),
    }),
  },
  Transactions: {
    description:
      "A live table of transactions. `status` filters which rows show: 'all', " +
      "'pending' (awaiting approval), 'approved', or 'denied' (defaults to " +
      "'all'). Data is bound on the client — do NOT pass numbers or rows.",
    props: z.object({
      status: z.enum(["all", "pending", "approved", "denied"]).optional(),
    }),
  },
};

export type Definitions = typeof definitions;
