import { z } from "zod";

/**
 * Deterministic A2UI op-builder for the Keel operations report canvas.
 * SERVER-SAFE: no React, no JSX, no "use client", no .tsx imports — Task 9's
 * agent.ts imports this module for the render_ops_report tool.
 *
 * The agent picks WHAT to show (a tiny structured, label-only selection: title,
 * summary, which KPIs, which charts, which runs table); this module expands that
 * into the verbose A2UI v0.9 operations deterministically. Keeping expansion
 * deterministic (rather than having the model author the component JSON inline)
 * is what keeps generation fast and reliable — the model only emits the tiny
 * selection below. Data is NOT carried in the ops: KpiCard/RunChart/RunsTable
 * bind live client data via useSkinData<KeelData>() in the report catalog
 * renderers (canvas-surface.tsx).
 *
 * SCOPE (spec §8): this file + canvas-surface.tsx are the single DROPPABLE unit.
 * Dropping the pair leaves OGUI rendering full-region on the shared shell canvas
 * and the required `catalog` (RunSummary) contract field still satisfied.
 */

/** Must match the middleware's key so tryParseA2UIOperations detects the ops. */
export const A2UI_OPERATIONS_KEY = "a2ui_operations";

/** The surface id the operations report renders under. */
export const SURFACE_ID = "keel-ops-report";

/**
 * The report's OWN a2ui catalog id. MUST equal the catalogId of the inline
 * report catalog created in canvas-surface.tsx. Deliberately NOT "keel" — that
 * id belongs to the minimal RunSummary contract catalog in catalog/index.tsx,
 * which is a separate catalog that survives when this droppable pair is cut.
 */
const REPORT_CATALOG_ID = "keel-report";

const OPS_KPIS = [
  "openRuns",
  "blockedRuns",
  "approvalsAwaiting",
  "medianCycleTime",
] as const;

const OPS_CHARTS = [
  "throughputByPlaybook",
  "bottleneckByStep",
  "statusBreakdown",
] as const;

const OPS_RUN_FILTERS = ["all", "blocked", "running", "completed"] as const;

type OpsKpi = (typeof OPS_KPIS)[number];

/** Captions assigned here so the agent needn't supply them. */
const KPI_LABELS: Record<OpsKpi, string> = {
  openRuns: "Open runs",
  blockedRuns: "Blocked runs",
  approvalsAwaiting: "Awaiting your approval",
  medianCycleTime: "Median cycle time",
};

/** Parameters for the render_ops_report tool (kept intentionally small). */
export const renderOpsReportParams = z.object({
  title: z
    .string()
    .describe(
      "Short report title, e.g. 'Operations overview'. LABEL ONLY — no figures, counts, durations, percentages, or trend claims.",
    ),
  summary: z
    .string()
    .optional()
    .describe(
      "Optional one-line NEUTRAL caption under the title. Label-only — no figures, counts, durations, percentages, or trends.",
    ),
  kpis: z
    .array(z.enum(OPS_KPIS))
    .describe(
      "Which KPI tiles to show, in order: 'openRuns', 'blockedRuns', 'approvalsAwaiting' (awaiting the current role), 'medianCycleTime'. Pick those relevant to the question.",
    ),
  charts: z
    .array(z.enum(OPS_CHARTS))
    .describe(
      "Which charts to show, in order: 'throughputByPlaybook' (runs per playbook), 'bottleneckByStep' (where blocked runs pile up), 'statusBreakdown' (runs by status).",
    ),
  runs: z
    .enum(OPS_RUN_FILTERS)
    .optional()
    .describe(
      "Include a live runs table filtered by status: 'all', 'blocked', 'running', or 'completed'. Omit to leave it out.",
    ),
});

type RenderOpsReportSpec = z.infer<typeof renderOpsReportParams>;

type A2UIOp = Record<string, unknown> & { version?: string };
type Component = { id: string; component: string } & Record<string, unknown>;

/**
 * Expand a report selection into A2UI v0.9 operations:
 * createSurface + updateComponents (flat components, root id "root").
 */
export function buildOpsReportOps(
  spec: RenderOpsReportSpec,
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
        component: "KpiCard",
        metric,
        label: KPI_LABELS[metric],
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
      components.push({ id, component: "RunChart", kind });
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

  if (spec.runs) {
    components.push({
      id: "runs-table",
      component: "RunsTable",
      filter: spec.runs,
    });
    rootChildren.push("runs-table");
  }

  components.unshift({
    id: "root",
    component: "Stack",
    gap: "lg",
    children: rootChildren,
  });

  return [
    {
      version: "v0.9",
      createSurface: { surfaceId, catalogId: REPORT_CATALOG_ID },
    },
    { version: "v0.9", updateComponents: { surfaceId, components } },
  ];
}
