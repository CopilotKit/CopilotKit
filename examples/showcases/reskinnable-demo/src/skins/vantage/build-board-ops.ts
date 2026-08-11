import { z } from "zod";

import { DEFAULT_LENS, parseLens } from "./data/lens";
import type { Lens } from "./data/types";

/**
 * Deterministic A2UI op-builder for the Vantage board canvas.
 *
 * This module is deliberately React-free. It is imported by BOTH the
 * server-only agent (agent.ts, which emits these ops from a `defineTool`
 * result) and the client canvas (canvas-surface.tsx). Any React import, or
 * any use of `"use client"`, would break the server side — agent.ts is loaded
 * by the server-only agent registry and must never pull React or JSX into the
 * API route's server bundle.
 *
 * The agent picks WHAT to show — a tiny structured selection — and this module
 * expands it into the verbose A2UI v0.9 operations. Keeping the expansion
 * deterministic (rather than having the reasoning model author the component
 * JSON inline) is what keeps generation fast and reliable.
 *
 * **The ops never carry a figure.** StatCard/Panel bind live client data through
 * the board-data context, so the canvas cannot show a number the app disagrees
 * with. The agent supplies only metric/panel selections, the lens, and
 * label-only text.
 *
 * The ops are therefore the ONLY channel through which the agent's lens and
 * metric selection reach the client. `extractBoardBinding` is the reader half of
 * that channel — see its comment; without it the canvas binds DEFAULT_LENS and
 * silently shows the wrong quarter under the right heading.
 */

/** Must match the middleware's A2UI_OPERATIONS_KEY so tryParseA2UIOperations detects it. */
export const A2UI_OPERATIONS_KEY = "a2ui_operations";

export const SURFACE_ID = "vantage-board";

export const CATALOG_ID = "https://cpk-a2ui.local/catalogs/vantage/v1";

export const BOARD_METRICS = [
  "arr",
  "nrr",
  "pipeline_coverage",
  "cac_payback",
  "logo_churn",
  "magic_number",
] as const;
export type BoardMetric = (typeof BOARD_METRICS)[number];

export const BOARD_PANELS = [
  "trend",
  "breakdown-segment",
  "breakdown-region",
  "plan-variance",
] as const;
export type BoardPanel = (typeof BOARD_PANELS)[number];

/** Human captions per KPI — assigned here so the agent needn't supply them. */
const METRIC_LABELS: Record<BoardMetric, string> = {
  arr: "ARR",
  nrr: "Net revenue retention",
  pipeline_coverage: "Pipeline coverage",
  cac_payback: "CAC payback",
  logo_churn: "Logo churn",
  magic_number: "Magic number",
};

/** Human titles per chart panel — likewise assigned here, not by the agent. */
const PANEL_TITLES: Record<BoardPanel, string> = {
  trend: "ARR over time",
  "breakdown-segment": "ARR by segment",
  "breakdown-region": "ARR by region",
  "plan-variance": "Plan variance by region",
};

/** Parameters for the render_board tool (kept intentionally small). */
export const renderBoardParams = z.object({
  title: z
    .string()
    .describe(
      "Board heading, e.g. 'Q3 2026 executive review'. LABEL ONLY — no figures, amounts, percentages, or trend claims.",
    ),
  summary: z
    .string()
    .optional()
    .describe(
      "One-line NEUTRAL read under the heading — the 'so what'. Label-only: no figures, amounts, percentages, or trends.",
    ),
  kpis: z
    .array(z.enum(BOARD_METRICS))
    .max(4)
    .describe("KPI tiles across the top, in reading order."),
  panels: z
    .array(z.enum(BOARD_PANELS))
    .max(4)
    .describe("Chart panels below the tiles, in reading order."),
  period: z
    .enum(["q3-2026", "q2-2026", "q1-2026", "h1-2026", "ttm"])
    .optional()
    .describe(
      "Reporting period for every tile and panel. Defaults to q3-2026.",
    ),
  region: z
    .enum(["all", "namer", "emea", "apac"])
    .optional()
    .describe("Region filter. Defaults to all."),
  segment: z
    .enum(["all", "enterprise", "mid-market", "smb"])
    .optional()
    .describe("Segment filter. Defaults to all."),
  currency: z
    .enum(["reported", "constant"])
    .optional()
    .describe("Currency basis. Defaults to reported."),
  footnote: z
    .string()
    .optional()
    .describe(
      "Optional one-line footnote. Label-only — no figures, amounts, or trends.",
    ),
});
export type RenderBoardSpec = z.infer<typeof renderBoardParams>;

export type A2UIOp = Record<string, unknown> & { version?: string };

type Component = { id: string; component: string } & Record<string, unknown>;

/**
 * Expand a board selection into A2UI v0.9 operations:
 * createSurface + updateComponents (flat components, root id "root").
 *
 * The envelope shape matters and is easy to get wrong silently: every op
 * carries `version: "v0.9"`, and `createSurface` has NO `root` key — the root
 * is identified purely by convention, as the component in `updateComponents`
 * whose `id` is the literal string "root". Banking's build-report-ops.ts is
 * the authority for this shape (it emits the identical envelope). Get either
 * detail wrong and the canvas renders permanently blank with no error thrown
 * and no test failing — there is nothing here that validates the envelope
 * against what the renderer expects, so this comment is the only record of
 * the finding.
 */
export function buildBoardOps(
  spec: RenderBoardSpec,
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

  // The lens rides on every data-bound component. The canvas reads it back off
  // the ops (extractBoardBinding) and binds it ONCE, in BoardDataProvider — the
  // renderers never read these props, and must not: one provider fetch per
  // board is the whole point of ops that carry no figures.
  //
  // Defaults come from DEFAULT_LENS rather than being retyped here, so the
  // board and the pages cannot disagree about what "no filter" means.
  const lens = {
    period: spec.period ?? DEFAULT_LENS.period,
    region: spec.region ?? DEFAULT_LENS.region,
    segment: spec.segment ?? DEFAULT_LENS.segment,
    currency: spec.currency ?? DEFAULT_LENS.currency,
  };

  if (spec.kpis.length) {
    const kpiIds = spec.kpis.map((metric) => {
      const id = `kpi-${metric}`;
      components.push({
        id,
        component: "StatCard",
        metric,
        label: METRIC_LABELS[metric],
        ...lens,
      });
      return id;
    });
    components.push({
      id: "kpi-grid",
      component: "Grid",
      columns: Math.min(kpiIds.length, 4),
      children: kpiIds,
    });
    rootChildren.push("kpi-grid");
  }

  for (const panel of spec.panels) {
    const id = `panel-${panel}`;
    components.push({
      id,
      component: "Panel",
      kind: panel,
      title: PANEL_TITLES[panel],
      ...lens,
    });
    rootChildren.push(id);
  }

  if (spec.footnote) {
    components.push({
      id: "footnote",
      component: "Text",
      text: spec.footnote,
      tone: "muted",
    });
    rootChildren.push("footnote");
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

/** What the canvas must bind for a board's figures to match its heading. */
export interface BoardBinding {
  /** The slice every tile and panel on this board is reported under. */
  lens: Lens;
  /** Exactly the KPIs this board's StatCards ask for, in reading order. */
  metrics: BoardMetric[];
}

const LENS_KEYS = ["period", "region", "segment", "currency"] as const;

const lensBagOf = (
  component: Component,
): Record<string, string | undefined> => {
  const bag: Record<string, string | undefined> = {};
  for (const key of LENS_KEYS) {
    const value = component[key];
    if (typeof value === "string") bag[key] = value;
  }
  return bag;
};

const isBoardMetric = (value: unknown): value is BoardMetric =>
  typeof value === "string" &&
  (BOARD_METRICS as readonly string[]).includes(value);

/**
 * Read back what `buildBoardOps` wrote: the lens the agent selected and the
 * metrics its StatCards need.
 *
 * This exists because the ops are the only channel between the SERVER tool and
 * the client canvas, and both halves fail silently if the canvas ignores them:
 * ignore the lens and a "Q2 2026 · EMEA" board shows Q3 all-regions figures;
 * ignore the metrics and any tile outside the four DEFAULT_KPIS finds nothing
 * to render and vanishes. Neither throws, so the reader must be explicit.
 *
 * `parseLens` does the coercion, so the board's lens goes through the SAME
 * codec as the URL and the tools — the axes it does not carry (compare, grain)
 * fall back to DEFAULT_LENS rather than to a second opinion.
 */
export function extractBoardBinding(ops: A2UIOp[]): BoardBinding | null {
  const components = ops.flatMap((op) => {
    const target = op.updateComponents as
      | { components?: Component[] }
      | undefined;
    return target?.components ?? [];
  });
  if (!components.length) return null;

  // Every data-bound component carries the same lens; the first one answers.
  const bound = components.find(
    (c) => c.component === "StatCard" || c.component === "Panel",
  );
  return {
    lens: parseLens(bound ? lensBagOf(bound) : {}),
    metrics: components
      .filter((c) => c.component === "StatCard")
      .map((c) => c.metric)
      .filter(isBoardMetric),
  };
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
