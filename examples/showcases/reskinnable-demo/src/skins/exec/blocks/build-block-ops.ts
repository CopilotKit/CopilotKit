import { CATALOG_ID } from "../catalog/definitions";
import type { BlockKind, BlockSpec } from "../data/types";

/**
 * Deterministic A2UI op-builder for exec dashboard blocks.
 *
 * The agent picks WHAT to show (a small structured selection, `BlockSpec`);
 * this module expands that into the verbose A2UI v0.9 operations. Keeping
 * the expansion deterministic (rather than having the reasoning model
 * author the full component JSON inline) is what keeps generation fast and
 * reliable — the model only emits the tiny selection.
 *
 * Data is NOT carried in the ops: MetricTile/TrendLine/VarianceBar/etc bind
 * live client data via useReportData() in the catalog renderers. The agent
 * supplies only a query descriptor (metricId/department/compare/months).
 */

/** Must match the middleware's A2UI_OPERATIONS_KEY so tryParseA2UIOperations detects it. */
export const A2UI_OPERATIONS_KEY = "a2ui_operations";

/** Prefix for block-scoped surface ids — the shell's inline-block-surface duplicates this spelling. */
export const BLOCK_SURFACE_PREFIX = "block:";

export type A2UIOp = Record<string, unknown> & { version?: string };

type Component = { id: string; component: string } & Record<string, unknown>;

/**
 * The three block kinds that render EXACTLY ONE metric, and so cannot be built
 * without a `metricId`. Shared with `agent.ts`'s `render_metric_block` guard —
 * that guard fires FIRST and returns this as a friendly tool result the model
 * can correct; `assertValidBlockSpec` below is the fallback for every other
 * path a `BlockSpec` can take (the ledger GET rebuilding ops for every pinned
 * block, `store.createDraftBlock`, tests) so an invalid spec can never
 * produce ops or reach storage, even if the model-facing guard is bypassed.
 */
export const METRIC_BOUND_KINDS: ReadonlySet<BlockKind> = new Set([
  "metricTile",
  "trendLine",
  "varianceBar",
]);

const ALL_BLOCK_KINDS: ReadonlySet<BlockKind> = new Set([
  "metricTile",
  "trendLine",
  "varianceBar",
  "initiativeTable",
  "exceptionList",
]);

/**
 * Throws for a `BlockSpec` that must never reach ops or storage:
 *
 *  - a metric-bound kind without a `metricId` — the catalog prop is
 *    REQUIRED, and `buildKindComponent` forwards it unguarded, so an
 *    unguarded caller would emit `metricId: undefined` for that prop: a
 *    tile bound to nothing, rendering blank with no error anywhere.
 *  - a `kind` outside `BlockKind` — `buildKindComponent`'s switch has no
 *    fallthrough case that would otherwise silently emit `undefined`.
 *
 * Same code and wording as `agent.ts`'s guard (`METRIC_ID_REQUIRED`), so a
 * caller that relays this thrown message (see `store-errors.ts`'s `CODE:
 * message` convention) tells the same story either way.
 */
export function assertValidBlockSpec(spec: BlockSpec): void {
  if (!ALL_BLOCK_KINDS.has(spec.kind)) {
    throw new Error(
      `UNKNOWN_BLOCK_KIND: unrecognized block kind "${spec.kind}"`,
    );
  }
  if (METRIC_BOUND_KINDS.has(spec.kind) && !spec.metricId) {
    throw new Error(
      `METRIC_ID_REQUIRED: a "${spec.kind}" block renders exactly one metric, so metricId is required`,
    );
  }
}

/**
 * Expand a block selection into A2UI v0.9 operations:
 * createSurface + updateComponents (flat components, root id "root").
 */
export function buildBlockOps(
  spec: BlockSpec,
  blockId: string,
  opts?: { pinned?: boolean },
): A2UIOp[] {
  assertValidBlockSpec(spec);
  const surfaceId = BLOCK_SURFACE_PREFIX + blockId;
  const components: Component[] = [];
  const rootChildren: string[] = [];

  components.push({ id: "heading", component: "Heading", text: spec.title });
  rootChildren.push("heading");

  const kindId = "kind";
  components.push(buildKindComponent(kindId, spec));
  rootChildren.push(kindId);

  if (!opts?.pinned) {
    components.push({
      id: "add-to-dashboard",
      component: "AddToDashboard",
      blockId,
    });
    rootChildren.push("add-to-dashboard");
  }

  components.unshift({
    id: "root",
    component: "Stack",
    gap: "md",
    children: rootChildren,
  });

  return [
    { version: "v0.9", createSurface: { surfaceId, catalogId: CATALOG_ID } },
    { version: "v0.9", updateComponents: { surfaceId, components } },
  ];
}

/** Build the one kind-specific component, forwarding only the props its catalog definition declares. */
function buildKindComponent(id: string, spec: BlockSpec): Component {
  switch (spec.kind) {
    case "metricTile":
      return {
        id,
        component: "MetricTile",
        metricId: spec.metricId,
        department: spec.department,
        compare: spec.compare,
      };
    case "trendLine":
      return {
        id,
        component: "TrendLine",
        metricId: spec.metricId,
        department: spec.department,
        months: spec.months,
      };
    case "varianceBar":
      // VarianceBar's catalog definition declares { metricId } only — do NOT
      // forward compare/department, zod would strip extras silently.
      return { id, component: "VarianceBar", metricId: spec.metricId };
    case "initiativeTable":
      // InitiativeTable takes no props.
      return { id, component: "InitiativeTable" };
    case "exceptionList":
      // ExceptionList takes `audience`, not part of BlockSpec — omit.
      return { id, component: "ExceptionList" };
    default: {
      // Exhaustiveness check: a `BlockKind` added above without a case here
      // fails to compile (the assignment below requires `never`). At
      // runtime this only fires for a spec `assertValidBlockSpec` didn't
      // already reject — belt-and-suspenders, not the primary guard.
      const exhaustive: never = spec.kind;
      throw new Error(
        `UNKNOWN_BLOCK_KIND: unrecognized block kind "${String(exhaustive)}"`,
      );
    }
  }
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

/** Whether a surface id belongs to a block (as opposed to a report canvas). */
export function isBlockSurfaceId(id: string | null): id is string {
  return typeof id === "string" && id.startsWith(BLOCK_SURFACE_PREFIX);
}
