import { z } from "zod";
import { CATALOG_ID } from "./catalog/definitions";

/**
 * Deterministic A2UI op-builder for Rowan's People Review brief canvas.
 *
 * SERVER-SAFE by construction: plain Zod + string constants, no React, no
 * `.tsx` imports. The skin's `agent.ts` (a server-only module) imports this to
 * define its render tool, so anything client-flavoured here would drag React
 * into the runtime bundle.
 *
 * The division of labour: the agent picks WHAT to show (the small `renderBrief`
 * selection below); this module expands that into the verbose A2UI v0.9
 * operations. Keeping the expansion deterministic — rather than having the model
 * author the full component JSON inline — is what keeps generation fast and
 * reliable; the model only emits the tiny selection.
 *
 * Data is NEVER carried in the ops. StatCard/LevelBreakdown/PeopleList bind live
 * client data via `useReportData()` in the catalog renderers. The agent supplies
 * only metric/list selections + label-only text, so it CANNOT fabricate a figure
 * — every number on the canvas is read from the ledger the page already shows.
 */

/** Must match the A2UI middleware's key so tryParseA2UIOperations detects it. */
export const A2UI_OPERATIONS_KEY = "a2ui_operations";

export const SURFACE_ID = "people-review";

export const BRIEF_METRICS = [
  "headcount",
  "outOfBandCount",
  "openRequests",
  "medianBandPosition",
] as const;
export type BriefMetric = (typeof BRIEF_METRICS)[number];

export const BRIEF_LISTS = ["outOfBand", "openRequests"] as const;
export type BriefList = (typeof BRIEF_LISTS)[number];

/** Human captions per KPI — assigned here so the agent needn't supply them. */
const METRIC_LABELS: Record<BriefMetric, string> = {
  headcount: "Headcount",
  outOfBandCount: "Out of band",
  openRequests: "Open requests",
  medianBandPosition: "Median band position",
};

/** Parameters for the render tool (kept intentionally small — SELECTIONS + labels). */
export const renderBriefParams = z.object({
  title: z
    .string()
    .describe(
      "Short brief title, e.g. 'People Review — Q3'. LABEL ONLY — no figures, counts, salaries, percentages, or trend claims.",
    ),
  kpis: z
    .array(z.enum(BRIEF_METRICS))
    .describe(
      "Which KPI stat cards to show, in order: 'headcount', 'outOfBandCount', 'openRequests', 'medianBandPosition'. Pick those relevant to the question.",
    ),
  levelBreakdown: z
    .boolean()
    .optional()
    .describe(
      "Include the compensation band-ladder level breakdown (the whole live roster plotted within band). Omit or false to leave it out.",
    ),
  lists: z
    .array(z.enum(BRIEF_LISTS))
    .optional()
    .describe(
      "Which detail lists to append, in order: 'outOfBand' (people outside their band) and/or 'openRequests' (pending queue items). Omit to leave them out.",
    ),
  summary: z
    .string()
    .optional()
    .describe(
      "Optional one-line NEUTRAL caption under the title. Label-only — no figures, counts, salaries, or trends.",
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
      columns: Math.min(spec.kpis.length, 4),
      children: kpiIds,
    });
    rootChildren.push("kpi-grid");
  }

  if (spec.levelBreakdown) {
    // No props: LevelBreakdown renders the whole live roster on the ladder.
    components.push({ id: "level-breakdown", component: "LevelBreakdown" });
    rootChildren.push("level-breakdown");
  }

  if (spec.lists?.length) {
    for (const kind of spec.lists) {
      const id = `list-${kind}`;
      components.push({ id, component: "PeopleList", kind });
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
