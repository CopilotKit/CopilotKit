import { z } from "zod";
import { CATALOG_ID } from "./catalog/definitions";

/**
 * Deterministic A2UI op-builder for the banking report canvas.
 *
 * The agent picks WHAT to show (a small structured selection); this module
 * expands that into the verbose A2UI v0.9 operations. Keeping the expansion
 * deterministic (rather than having the reasoning model author the full
 * component JSON inline) is what keeps generation fast and reliable — the
 * model only emits the tiny selection below.
 *
 * Data is NOT carried in the ops: StatCard/Chart/Transactions bind live client
 * data via useReportData() in the catalog renderers. The agent supplies only
 * metric/kind selections + label-only text.
 */

/** Must match the middleware's A2UI_OPERATIONS_KEY so tryParseA2UIOperations detects it. */
export const A2UI_OPERATIONS_KEY = "a2ui_operations";

export const SURFACE_ID = "spend-report";

export const REPORT_METRICS = [
  "totalSpend",
  "pendingCount",
  "overLimitCount",
  "policyCount",
] as const;
export type ReportMetric = (typeof REPORT_METRICS)[number];

export const REPORT_CHARTS = [
  "spendingTrend",
  "budgetUsage",
  "spendBreakdown",
  "incomeVsExpenses",
] as const;
export type ReportChart = (typeof REPORT_CHARTS)[number];

export const REPORT_TX_STATUSES = [
  "all",
  "pending",
  "approved",
  "denied",
] as const;
export type ReportTxStatus = (typeof REPORT_TX_STATUSES)[number];

/** Human captions for each KPI — assigned here so the agent needn't supply them. */
const METRIC_LABELS: Record<ReportMetric, string> = {
  totalSpend: "Total approved spend",
  pendingCount: "Pending approvals",
  overLimitCount: "Over limit",
  policyCount: "Expense policies",
};

/** Parameters for the render_report tool (kept intentionally small). */
export const renderReportParams = z.object({
  title: z
    .string()
    .describe(
      "Short report title, e.g. 'Q2 Spend Report'. LABEL ONLY — no figures, amounts, percentages, or trend claims.",
    ),
  kpis: z
    .array(z.enum(REPORT_METRICS))
    .describe(
      "Which KPI stat cards to show, in order. Pick those relevant to the question.",
    ),
  charts: z
    .array(z.enum(REPORT_CHARTS))
    .describe("Which charts to show, in order."),
  transactions: z
    .enum(REPORT_TX_STATUSES)
    .optional()
    .describe(
      "Include a live transactions table filtered by status: 'all', 'pending', 'approved', or 'denied'. Omit to leave it out.",
    ),
  summary: z
    .string()
    .optional()
    .describe(
      "Optional one-line NEUTRAL caption under the title. Label-only — no figures, amounts, percentages, or trends.",
    ),
});
export type RenderReportSpec = z.infer<typeof renderReportParams>;

export type A2UIOp = Record<string, unknown> & { version?: string };

type Component = { id: string; component: string } & Record<string, unknown>;

/**
 * Expand a report selection into A2UI v0.9 operations:
 * createSurface + updateComponents (flat components, root id "root").
 */
export function buildReportOps(
  spec: RenderReportSpec,
  surfaceId: string = SURFACE_ID,
): A2UIOp[] {
  const components: Component[] = [];
  const rootChildren: string[] = [];

  components.push({ id: "heading", component: "Heading", text: spec.title });
  rootChildren.push("heading");

  if (spec.summary) {
    components.push({
      id: "summary",
      component: "Text",
      text: spec.summary,
      tone: "muted",
    });
    rootChildren.push("summary");
  }

  if (spec.kpis.length) {
    const kpiIds = spec.kpis.map((metric) => {
      const id = `kpi-${metric}`;
      components.push({
        id,
        component: "StatCard",
        metric,
        label: METRIC_LABELS[metric],
      });
      return id;
    });
    components.push({
      id: "kpi-grid",
      component: "Grid",
      columns: Math.min(spec.kpis.length, 4),
      children: kpiIds,
    });
    rootChildren.push("kpi-grid");
  }

  if (spec.charts.length) {
    const chartIds = spec.charts.map((kind) => {
      const id = `chart-${kind}`;
      components.push({ id, component: "Chart", kind });
      return id;
    });
    components.push({
      id: "chart-grid",
      component: "Grid",
      columns: spec.charts.length >= 2 ? 2 : 1,
      children: chartIds,
    });
    rootChildren.push("chart-grid");
  }

  if (spec.transactions) {
    components.push({
      id: "transactions",
      component: "Transactions",
      status: spec.transactions,
    });
    rootChildren.push("transactions");
  }

  components.unshift({
    id: "root",
    component: "Stack",
    gap: "lg",
    children: rootChildren,
  });

  return [
    { version: "v0.9", createSurface: { surfaceId, catalogId: CATALOG_ID } },
    { version: "v0.9", updateComponents: { surfaceId, components } },
  ];
}

/** Read the surfaceId out of an A2UI operation list (any op kind). */
export function extractSurfaceId(ops: A2UIOp[]): string | null {
  for (const op of ops) {
    const target = (op.createSurface ??
      op.updateComponents ??
      op.updateDataModel) as { surfaceId?: string } | undefined;
    if (target?.surfaceId) return target.surfaceId;
  }
  return null;
}
