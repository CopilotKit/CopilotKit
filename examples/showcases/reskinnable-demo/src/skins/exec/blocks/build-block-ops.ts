import { CATALOG_ID, definitions } from "../catalog/definitions";
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
 * can correct, where `assertValidBlockSpec` below THROWS.
 *
 * The two are not redundant: the tool guard exists so the MODEL can retry, and
 * `assertValidBlockSpec` is the contract every OTHER path obeys (the ledger GET
 * rebuilding ops for every pinned block, `store.createDraftBlock`, seeds,
 * tests), so an invalid spec can never produce ops or reach storage even when
 * no model is involved.
 */
export const METRIC_BOUND_KINDS: ReadonlySet<BlockKind> = new Set([
  "metricTile",
  "trendLine",
  "varianceBar",
]);

/**
 * Every optional QUERY prop a `BlockSpec` can carry, keyed off the interface
 * itself: adding a field to `BlockSpec` fails to compile until it is listed
 * here (and therefore placed in `KIND_PROPS` below), instead of silently
 * becoming a prop no kind declares and no guard checks.
 */
const SPEC_QUERY_PROPS = {
  metricId: true,
  department: true,
  compare: true,
  months: true,
} satisfies Record<Exclude<keyof BlockSpec, "kind" | "title">, true>;

type SpecQueryProp = keyof typeof SPEC_QUERY_PROPS;

/**
 * The query props each kind's catalog definition actually declares — the
 * single source for both "is this a known kind" and "does this kind support
 * this prop", and the mirror of `buildKindComponent`'s forwarding below.
 *
 * `satisfies Record<BlockKind, …>` is what makes this EXHAUSTIVE: a new
 * `BlockKind` fails to compile here (and in `buildKindComponent`'s switch)
 * rather than compiling fine and being rejected at runtime as unknown.
 */
const KIND_PROPS = {
  metricTile: { metricId: true, department: true, compare: true },
  trendLine: { metricId: true, department: true, months: true },
  varianceBar: { metricId: true },
  initiativeTable: {},
  exceptionList: {},
} satisfies Record<BlockKind, Partial<Record<SpecQueryProp, true>>>;

const ALL_BLOCK_KINDS: ReadonlySet<BlockKind> = new Set(
  Object.keys(KIND_PROPS) as BlockKind[],
);

/**
 * The metric ids that will actually BIND, read off the catalog's own zod enum
 * rather than re-listed here — `MetricId` is a type, erased at runtime, and
 * `definitions` is already imported for `CATALOG_ID` (the data store is not
 * importable from here: it imports this module).
 */
const CATALOG_METRIC_IDS: ReadonlySet<string> = new Set(
  definitions.MetricTile.props.shape.metricId.options,
);

/**
 * Throws for a `BlockSpec` that must never reach ops or storage. Every failure
 * is one the RENDERER would otherwise absorb in silence — the catalog runs each
 * component's props through zod, which strips what it does not recognise, so a
 * bad spec produces a blank or wrong block and no error anywhere:
 *
 *  - a `kind` outside `BlockKind` — rejected here, up front, with a
 *    caller-facing code; `buildKindComponent`'s `default` arm throws too, but
 *    that is a belt-and-suspenders exhaustiveness check reached only after ops
 *    have begun to be built.
 *  - a metric-bound kind without a `metricId` — the catalog prop is REQUIRED
 *    and `buildKindComponent` forwards it unguarded, so the block would carry
 *    `metricId: undefined`: a tile bound to nothing.
 *  - a prop the kind does not support (compare on a trendLine, department on a
 *    varianceBar, months on a metricTile) — `buildKindComponent` forwards only
 *    the declared props, so the request is otherwise DROPPED and the block
 *    renders as if it had never been asked for.
 *  - a `metricId` outside the catalog enum — stripped by zod exactly like a
 *    missing one, so the tile renders blank.
 *  - a non-positive or fractional `months` — TrendLine narrows its series with
 *    `periods.slice(-months)` (`lastMonths` in `../catalog/renderers.tsx`), and
 *    `slice(-0)` is `slice(0)`: the FULL history on a chart the caller asked to
 *    narrow. The catalog declares `months` a positive int, so any other value
 *    can only produce a wrong window or a silently defaulted one.
 *
 * Codes and wording match `agent.ts`'s guard (`METRIC_ID_REQUIRED`) and
 * `store-errors.ts`'s `CODE: message` convention, so a caller that relays the
 * thrown message tells the same story either way.
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

  const supported: Partial<Record<SpecQueryProp, true>> = KIND_PROPS[spec.kind];
  for (const prop of Object.keys(SPEC_QUERY_PROPS) as SpecQueryProp[]) {
    if (spec[prop] === undefined) continue;
    if (!supported[prop]) {
      throw new Error(
        `KIND_PROP_UNSUPPORTED: a "${spec.kind}" block does not support "${prop}"`,
      );
    }
  }

  if (spec.metricId !== undefined && !CATALOG_METRIC_IDS.has(spec.metricId)) {
    throw new Error(
      `UNKNOWN_METRIC_ID: unrecognized metricId "${spec.metricId}"`,
    );
  }
  if (
    spec.months !== undefined &&
    (!Number.isInteger(spec.months) || spec.months <= 0)
  ) {
    throw new Error(
      `MONTHS_INVALID: a "${spec.kind}" block's months is a trailing window, so it must be a positive integer, got ${String(spec.months)}`,
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

/**
 * Build the one kind-specific component, forwarding only the props its catalog
 * definition declares — the runtime mirror of `KIND_PROPS` above, which
 * `assertValidBlockSpec` has already checked the spec against, so nothing
 * reaching here carries a prop this switch would have to drop.
 */
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
      // forward compare/department/months, zod would strip extras silently.
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

/** The op containers that carry a surfaceId, in the order they appear in a list. */
const SURFACE_OP_KEYS = [
  "createSurface",
  "updateComponents",
  "updateDataModel",
] as const;

/**
 * Read the surfaceId out of an A2UI operation list (any op kind).
 *
 * Each op is searched across ALL THREE containers, not `a ?? b ?? c`: `??`
 * stops at the first container that is merely PRESENT, so an op carrying both
 * a `createSurface` without a usable surfaceId and an `updateComponents` with
 * one returned null — and a null surface id is not "no block", it is a block
 * the shell cannot route inline.
 */
export function extractSurfaceId(ops: A2UIOp[]): string | null {
  for (const op of ops) {
    for (const key of SURFACE_OP_KEYS) {
      const target = op[key] as { surfaceId?: string } | undefined;
      if (target?.surfaceId) return target.surfaceId;
    }
  }
  return null;
}

/** Whether a surface id belongs to a block (as opposed to a report canvas). */
export function isBlockSurfaceId(id: string | null): id is string {
  return typeof id === "string" && id.startsWith(BLOCK_SURFACE_PREFIX);
}
