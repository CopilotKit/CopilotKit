import { z } from "zod";
import { CATALOG_ID } from "./catalog/definitions";

/**
 * Deterministic A2UI op-builder for Bellwether's Trading Review brief canvas.
 *
 * SERVER-SAFE by construction: plain Zod + string constants, no React, no `.tsx`
 * imports. The skin's `agent.ts` (a server-only module) imports this to define
 * its render tool, so anything client-flavoured here would drag React into the
 * runtime bundle.
 *
 * The division of labour: the agent picks WHAT to show (the small `renderBrief`
 * selection below); this module expands that into the verbose A2UI v0.9
 * operations. Keeping the expansion deterministic — rather than having the model
 * author the full component JSON inline — is what keeps generation fast and
 * reliable; the model only emits the tiny selection.
 *
 * Data is NEVER carried in the ops. StatCard/CategoryBreakdown/TradingList bind
 * live client data via `useReportData()` in the catalog renderers. The agent
 * supplies only metric/list selections + label-only text, so it CANNOT fabricate
 * a figure — every number on the canvas is read from the ledger the page already
 * shows.
 */

/** Must match the A2UI middleware's key so tryParseA2UIOperations detects it. */
export const A2UI_OPERATIONS_KEY = "a2ui_operations";

export const SURFACE_ID = "trading-review";

export const BRIEF_METRICS = [
  "ordersOnException",
  "valueAtRisk",
  "belowFloorSkus",
  "medianMargin",
  "pendingMarkdowns",
] as const;
export type BriefMetric = (typeof BRIEF_METRICS)[number];

export const BRIEF_LISTS = [
  "belowFloor",
  "exceptionOrders",
  "pendingMarkdowns",
] as const;
export type BriefList = (typeof BRIEF_LISTS)[number];

/** Human captions per KPI — assigned here so the agent needn't supply them. */
const METRIC_LABELS: Record<BriefMetric, string> = {
  ordersOnException: "Orders on exception",
  valueAtRisk: "Value at risk",
  belowFloorSkus: "SKUs below floor",
  medianMargin: "Median margin",
  pendingMarkdowns: "Markdowns pending",
};

/** Parameters for the render tool (kept intentionally small — SELECTIONS + labels). */
export const renderBriefParams = z.object({
  title: z
    .string()
    .describe(
      "Short brief title, e.g. 'Trading Review — Week 40'. LABEL ONLY — no figures, counts, prices, percentages, or trend claims.",
    ),
  kpis: z
    .array(z.enum(BRIEF_METRICS))
    .describe(
      "Which KPI stat cards to show, in order: 'ordersOnException', 'valueAtRisk', 'belowFloorSkus', 'medianMargin', 'pendingMarkdowns'. Pick those relevant to the question.",
    ),
  categoryBreakdown: z
    .boolean()
    .optional()
    .describe(
      "Include the margin-ladder category breakdown (the whole live range plotted against each category floor). Omit or false to leave it out.",
    ),
  lists: z
    .array(z.enum(BRIEF_LISTS))
    .optional()
    .describe(
      "Which detail lists to append, in order: 'belowFloor' (products under their category floor), 'exceptionOrders' (orders still stuck) and/or 'pendingMarkdowns' (markdowns awaiting a decision). Omit to leave them out.",
    ),
  summary: z
    .string()
    .optional()
    .describe(
      "Optional one-line NEUTRAL caption under the title. Label-only — no figures, counts, prices, or trends.",
    ),
});
export type RenderBriefSpec = z.infer<typeof renderBriefParams>;

export type A2UIOp = Record<string, unknown> & { version?: string };
type Component = { id: string; component: string } & Record<string, unknown>;

/**
 * Expand a brief selection into A2UI v0.9 operations: createSurface +
 * updateComponents (a FLAT component list, rooted at id "root"). Children are
 * referenced by id, never embedded — that flat shape is what the A2UI runtime
 * expects and what the renderers resolve against.
 */
export function buildBriefOps(
  spec: RenderBriefSpec,
  surfaceId: string = SURFACE_ID,
): A2UIOp[] {
  // De-duplicate the selections BEFORE expanding them. zod arrays do not
  // deduplicate, and this tool is driven by an LLM: a plausible generation like
  // kpis:["valueAtRisk","valueAtRisk"] would otherwise expand into duplicate
  // component ids ("kpi-valueAtRisk"), because every id below is derived from the
  // selection value. A duplicate id is not cosmetic — a2ui's componentsModel is a
  // MAP keyed by id, so the second entry silently overwrites the first (one card
  // renders where two were asked for) while the Grid renderer's
  // `children.map((id) => <Slot key={id} …>)` emits a React duplicate-key warning.
  // `[...new Set(...)]` keeps first-occurrence order, so this module's
  // deterministic ordering guarantee is preserved (dedupe never reorders).
  //
  // De-duplicating rather than REJECTING is deliberate: this builder feeds the
  // demo's canvas brief, and a repeated entry is an ordinary model slip with an
  // unambiguous intent ("show this card"). Throwing would blank the canvas
  // mid-presentation over a spec we can honour exactly. The schema still rejects
  // anything uncatalogued, so dedupe never silences a real disagreement.
  //
  // The remaining ids are fixed constants ("heading", "summary", "kpi-grid",
  // "category-breakdown", "root"), and the two value-derived families are
  // namespaced by disjoint prefixes ("kpi-" vs "list-"), so post-dedupe the whole
  // emitted tree has unique ids — locked by build-brief-ops.test.ts.
  const kpis = [...new Set(spec.kpis)];
  const lists = [...new Set(spec.lists ?? [])];

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

  if (kpis.length) {
    const kpiIds = kpis.map((metric) => {
      const id = `kpi-${metric}`;
      // Only the label travels in the op; the VALUE is computed live in the
      // StatCard renderer from useReportData(). That is the "ops carry no data"
      // rule in one line.
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
      columns: Math.min(kpis.length, 4),
      children: kpiIds,
    });
    rootChildren.push("kpi-grid");
  }

  if (spec.categoryBreakdown) {
    // No props: CategoryBreakdown renders the whole live range on the ladder.
    components.push({
      id: "category-breakdown",
      component: "CategoryBreakdown",
    });
    rootChildren.push("category-breakdown");
  }

  if (lists.length) {
    for (const kind of lists) {
      const id = `list-${kind}`;
      components.push({ id, component: "TradingList", kind });
      rootChildren.push(id);
    }
  }

  // Root goes in FIRST (index 0). The A2UI runtime resolves the tree from the
  // component whose id is "root", so it must be present; unshift keeps the rest
  // of the list in authored order for readability.
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
