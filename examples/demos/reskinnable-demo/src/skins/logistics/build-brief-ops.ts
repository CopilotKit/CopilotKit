import { z } from "zod";
import { CATALOG_ID } from "./catalog/definitions";

/** Must match the A2UI middleware's key so tryParseA2UIOperations detects it. */
export const A2UI_OPERATIONS_KEY = "a2ui_operations";

export const SURFACE_ID = "decision-brief";

export const BRIEF_METRICS = [
  "onTimeRate",
  "atRiskCount",
  "exposureUsd",
  "avgDelayDays",
] as const;
export type BriefMetric = (typeof BRIEF_METRICS)[number];

export const BRIEF_CHARTS = [
  "lanePerformance",
  "exposureByLane",
  "delayTrend",
  "modeSplit",
] as const;
export type BriefChart = (typeof BRIEF_CHARTS)[number];

export const BRIEF_TABLE_STATUSES = [
  "all",
  "at_risk",
  "delayed",
  "on_track",
] as const;
export type BriefTableStatus = (typeof BRIEF_TABLE_STATUSES)[number];

/** Human captions per KPI — assigned here so the agent needn't supply them. */
const METRIC_LABELS: Record<BriefMetric, string> = {
  onTimeRate: "On-time rate",
  atRiskCount: "Shipments at risk",
  exposureUsd: "Value exposed",
  avgDelayDays: "Average delay",
};

export const renderBriefParams = z.object({
  title: z
    .string()
    .describe(
      "Short brief title, e.g. 'Trans-Pacific Exceptions'. LABEL ONLY — no figures, amounts, counts, or trend claims.",
    ),
  kpis: z
    .array(z.enum(BRIEF_METRICS))
    .describe("Which KPI stat cards to show, in order."),
  charts: z
    .array(z.enum(BRIEF_CHARTS))
    .describe("Which charts to show, in order."),
  exceptions: z
    .enum(BRIEF_TABLE_STATUSES)
    .optional()
    .describe(
      "Include a live shipment table filtered by status. Omit to leave it out.",
    ),
  tradeoffShipmentId: z
    .string()
    .optional()
    .describe(
      "Include the live mitigation trade-off table for this shipment id (e.g. 'shp-4821'). Omit to leave it out.",
    ),
  summary: z
    .string()
    .optional()
    .describe(
      "Optional one-line NEUTRAL caption under the title. Label-only — no figures, amounts, or trends.",
    ),
});
export type RenderBriefSpec = z.infer<typeof renderBriefParams>;

export type A2UIOp = Record<string, unknown> & { version?: string };
type Component = { id: string; component: string } & Record<string, unknown>;

/**
 * Expand a brief selection into A2UI v0.9 operations (createSurface +
 * updateComponents, flat components under root id "root").
 *
 * Data is NOT carried in the ops: StatCard/Chart/ExceptionTable/TradeoffTable
 * bind live client data through useBriefData(). The agent supplies only
 * selections and label-only text.
 */
export function buildBriefOps(
  spec: RenderBriefSpec,
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

  if (spec.tradeoffShipmentId) {
    components.push({
      id: "tradeoffs",
      component: "TradeoffTable",
      shipmentId: spec.tradeoffShipmentId,
    });
    rootChildren.push("tradeoffs");
  }

  if (spec.exceptions) {
    components.push({
      id: "exceptions",
      component: "ExceptionTable",
      status: spec.exceptions,
    });
    rootChildren.push("exceptions");
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
