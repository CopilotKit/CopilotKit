/**
 * In-memory, seed-built store for the Vantage (Cascade Industries) executive
 * ledger — keel's `* as store` module-scope pattern applied here.
 *
 * Seeded once at module init and rebuilt from the seed builders on `reset()`,
 * so mutations never bleed back into a shared literal and restarting the dev
 * server (or calling `reset()` from the presenter's dev-reset route) restores
 * the exact demo starting state.
 *
 * Exceptions are DERIVED, never stored: `exceptions()` recomputes breaches
 * from `points` + `metricDefs` + `narratives` on every call via
 * `./derive`'s `variancePct`/`isBreach`, which is also what the client
 * catalog renderers use — one formula, never two that can drift.
 *
 * Drafts (blocks created by `render_metric_block` before anyone pins them)
 * live in a separate `drafts` map, never on a dashboard, until
 * `addBlockToDashboard` moves them across — that separation is what makes a
 * chat-rendered block invisible to the dashboard pages until it is pinned —
 * the operator's "Add to dashboard" click or the agent's
 * `pinBlockToDashboard` call.
 *
 * `drafts` is UNPINNED, not "not yet pinned": `removeBlock` moves a block
 * back into it rather than destroying it, so the pin control still on screen
 * in the chat transcript (and the agent still holding the id) can re-pin it.
 * Pinning is single-home in both directions — a block is on at most one
 * dashboard, and `addBlockToDashboard` refuses ALREADY_PINNED rather than
 * multi-homing it.
 */

import { assertValidBlockSpec } from "../blocks/build-block-ops";
import {
  isBreach,
  latestClosedPeriod,
  variancePct as deriveVariancePct,
} from "./derive";
import {
  seedDashboards,
  seedInitiatives,
  seedMetricDefs,
  seedPoints,
} from "./seed";
import type {
  BlockSpec,
  BoardPack,
  Dashboard,
  DashboardBlock,
  DashboardId,
  Department,
  Exception,
  Initiative,
  LedgerSnapshot,
  MetricDef,
  MetricId,
  MetricPoint,
  Narrative,
} from "./types";

/** Re-exported verbatim, never reimplemented — see the module comment above. */
export const variancePct = deriveVariancePct;

/** Beat 3a's withheld secret. REST-only: never surface this in a prompt. */
export const COUNTERSIGN_PIN = "7341";

interface State {
  metricDefs: MetricDef[];
  points: MetricPoint[];
  initiatives: Initiative[];
  narratives: Narrative[];
  dashboards: Record<DashboardId, Dashboard>;
  packs: BoardPack[];
  /** Blocks created by `createDraftBlock` but not yet pinned to a dashboard. */
  drafts: Map<string, DashboardBlock>;
}

function buildSeedState(): State {
  return {
    metricDefs: seedMetricDefs(),
    points: seedPoints(),
    initiatives: seedInitiatives(),
    narratives: [],
    dashboards: seedDashboards(),
    packs: [],
    drafts: new Map(),
  };
}

let state: State = buildSeedState();
let idCounter = 0;
const nextId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${idCounter++}`;

/** Put the ledger back to the state the demo starts from. */
export function reset(): void {
  state = buildSeedState();
  idCounter = 0;
}

/** The one snapshot read — see `LedgerSnapshot`'s doc comment in `types.ts`. */
export function snapshot(): LedgerSnapshot {
  return {
    metricDefs: state.metricDefs,
    points: state.points,
    initiatives: state.initiatives,
    narratives: state.narratives,
    dashboards: state.dashboards,
    packs: state.packs,
    exceptions: exceptions(),
  };
}

/**
 * A metric's points, period-windowed (not row-sliced): `months` keeps the
 * last N DISTINCT sorted periods and filters to them, so a department filter
 * combined with `months` never truncates mid-period for a metric whose rows
 * span several departments. Mirrors the fixed getter in
 * `src/skins/exec/sandbox-functions.ts`.
 */
export function metricSeries(q: {
  metricId: MetricId;
  department?: Department | "all";
  months?: number;
}): MetricPoint[] {
  let rows = state.points.filter((p) => p.metricId === q.metricId);
  if (q.department) rows = rows.filter((p) => p.department === q.department);
  rows = [...rows].sort((a, b) =>
    a.period < b.period ? -1 : a.period > b.period ? 1 : 0,
  );
  if (q.months) {
    const periods = [...new Set(rows.map((r) => r.period))].sort();
    const keep = new Set(periods.slice(-q.months));
    rows = rows.filter((r) => keep.has(r.period));
  }
  return rows;
}

/**
 * Breaches at the latest CLOSED period only — never the full 24-month
 * history. `explained` is true iff a narrative has been filed for that exact
 * `(metricId, period)` pair; a narrative filed for a different period never
 * clears a breach.
 */
export function exceptions(): Exception[] {
  const latest = latestClosedPeriod(state.points);
  const defsById = new Map(state.metricDefs.map((d) => [d.id, d]));
  return state.points
    .filter((p) => p.period === latest)
    .filter((p) => {
      const def = defsById.get(p.metricId);
      return def ? isBreach(def, p) : false;
    })
    .map((p) => ({
      metricId: p.metricId,
      period: p.period,
      department: p.department,
      variancePct: variancePct(p),
      explained: state.narratives.some(
        (n) => n.metricId === p.metricId && n.period === p.period,
      ),
    }));
}

export function fileNarrative(n: Omit<Narrative, "id" | "filedAt">): Narrative {
  const narrative: Narrative = {
    ...n,
    id: nextId("nar"),
    filedAt: new Date().toISOString(),
  };
  state.narratives.push(narrative);
  return narrative;
}

/**
 * Created in the drafts map — NOT on any dashboard until `addBlockToDashboard`.
 *
 * `assertValidBlockSpec` runs here too, not just in `buildBlockOps`, so a bad
 * spec can never be STORED — the ledger GET route rebuilds every pinned
 * block's ops from the stored spec on every read (see
 * `app/api/exec/v1/ledger/route.ts`), so a spec that slipped in here would
 * throw there instead, on a read nobody expects to fail. `render_metric_block`
 * in `agent.ts` already screens this before calling in, so this only fires
 * for some OTHER caller with a spec that guard didn't see.
 */
export function createDraftBlock(spec: BlockSpec): DashboardBlock {
  assertValidBlockSpec(spec);
  const block: DashboardBlock = {
    id: nextId("block"),
    spec,
    addedAt: new Date().toISOString(),
  };
  state.drafts.set(block.id, block);
  return block;
}

/** The dashboard currently holding `blockId`, or undefined if none does. */
function dashboardHolding(blockId: string): Dashboard | undefined {
  return Object.values(state.dashboards).find((d) =>
    d.blocks.some((b) => b.id === blockId),
  );
}

/**
 * Moves a block onto a dashboard, from `drafts` or from nowhere else.
 *
 * Three outcomes, each distinguishable by the caller — the routes map the
 * thrown codes onto statuses (`NOT_FOUND` → 404, `ALREADY_PINNED` → 409):
 *
 *  - Already on THIS dashboard → the existing instance, list unchanged.
 *    Idempotent, because a double-click and a retried tool call both land here.
 *  - Already on the OTHER dashboard → `ALREADY_PINNED`, naming that dashboard.
 *    A block is single-homed (see `removeBlock`), and this is the one refusal
 *    that must not be reported as NOT_FOUND: "no draft block" reads to the
 *    agent as "render it again", and it obliges — producing a duplicate block
 *    instead of unpinning the one that already exists.
 *  - Otherwise it must be a draft, else `NOT_FOUND` — the shape a
 *    hallucinated `blockId` from `pinBlockToDashboard` takes.
 *
 * Each thrown message carries its OWN remedy ("render the block first" vs
 * "unpin it there first") because the relays above it — the POST route, the
 * ledger context, `pinBlockToDashboard`'s failure arm — forward the message
 * verbatim rather than appending advice of their own. One remedy per code, in
 * one place, is what stops ALREADY_PINNED being answered with NOT_FOUND's
 * advice and the agent re-rendering a block that already exists.
 */
export function addBlockToDashboard(
  dashboardId: DashboardId,
  blockId: string,
): DashboardBlock {
  const dashboard = state.dashboards[dashboardId];
  const existing = dashboard.blocks.find((b) => b.id === blockId);
  if (existing) return existing;
  const holder = dashboardHolding(blockId);
  if (holder) {
    throw new Error(
      `ALREADY_PINNED: block "${blockId}" is already pinned to the "${holder.id}" dashboard — unpin it there first`,
    );
  }
  const draft = state.drafts.get(blockId);
  if (!draft) {
    throw new Error(
      `NOT_FOUND: no draft block "${blockId}" — render the block first, then pin the id it returns`,
    );
  }
  dashboard.blocks.push(draft);
  state.drafts.delete(blockId);
  return draft;
}

/**
 * Unpins a block: back to `drafts`, NOT destroyed.
 *
 * That direction is load-bearing, not tidiness. The chat transcript keeps
 * rendering the block's `AddToDashboard` control after an unpin, and the
 * agent's `pinBlockToDashboard` keeps holding the same id — both address the
 * block by id after it leaves the dashboard. Deleting it outright turned
 * every one of those into a 404 "no draft block", which is the
 * revive-a-dead-id confusion the module comment's drafts/dashboard
 * separation exists to prevent. Returning it to `drafts` restores exactly
 * the pre-pin state, so a re-pin (to either dashboard) simply works.
 *
 * Throws `NOT_FOUND` when the block is not on THIS dashboard — including
 * when it sits on the other one. A silent no-op made a failed unpin
 * indistinguishable from a successful one at the DELETE route, which
 * answered 200 with the untouched list either way.
 */
export function removeBlock(dashboardId: DashboardId, blockId: string): void {
  const dashboard = state.dashboards[dashboardId];
  const block = dashboard.blocks.find((b) => b.id === blockId);
  if (!block) {
    throw new Error(
      `NOT_FOUND: no block "${blockId}" on the "${dashboardId}" dashboard`,
    );
  }
  dashboard.blocks = dashboard.blocks.filter((b) => b.id !== blockId);
  state.drafts.set(block.id, block);
}

/**
 * Reorders a block within its dashboard by one position.
 *
 * `NOT_FOUND` for a block that is not on this dashboard, for the same reason
 * `removeBlock` throws. A move that would fall off either END is a different
 * case and stays a silent, successful no-op: the block exists and the order
 * already is what was asked for, and the grid disables those buttons anyway
 * (`../components/dashboard-grid.tsx`).
 */
export function moveBlock(
  dashboardId: DashboardId,
  blockId: string,
  direction: "up" | "down",
): void {
  const dashboard = state.dashboards[dashboardId];
  const index = dashboard.blocks.findIndex((b) => b.id === blockId);
  if (index === -1) {
    throw new Error(
      `NOT_FOUND: no block "${blockId}" on the "${dashboardId}" dashboard`,
    );
  }
  const swapWith = direction === "up" ? index - 1 : index + 1;
  if (swapWith < 0 || swapWith >= dashboard.blocks.length) return;
  const blocks = [...dashboard.blocks];
  [blocks[index], blocks[swapWith]] = [blocks[swapWith], blocks[index]];
  dashboard.blocks = blocks;
}

/** The metric ids a dashboard's blocks reference, for the publish gate below. */
function referencedMetrics(dashboard: Dashboard): {
  includesAll: boolean;
  metricIds: Set<MetricId>;
} {
  // An `exceptionList` block surfaces every metric's exceptions, so its
  // presence on a dashboard means the gate must consider ALL metrics, not
  // just the ones with their own dedicated block.
  const includesAll = dashboard.blocks.some(
    (b) => b.spec.kind === "exceptionList",
  );
  const metricIds = new Set(
    dashboard.blocks
      .map((b) => b.spec.metricId)
      .filter((id): id is MetricId => Boolean(id)),
  );
  return { includesAll, metricIds };
}

/**
 * Order: wrong PIN first (never leak variance state to a bad countersign),
 * then unexplained breaches among the metrics THIS dashboard's blocks
 * reference at the latest closed period, else record and return the pack.
 */
export function publishPack(
  dashboardId: DashboardId,
  countersignPin: string,
):
  | { ok: true; pack: BoardPack }
  | { ok: false; status: 403; code: "BAD_COUNTERSIGN" }
  | {
      ok: false;
      status: 422;
      code: "UNEXPLAINED_VARIANCE";
      breaches: Exception[];
    } {
  if (countersignPin !== COUNTERSIGN_PIN) {
    return { ok: false, status: 403, code: "BAD_COUNTERSIGN" };
  }

  const dashboard = state.dashboards[dashboardId];
  const { includesAll, metricIds } = referencedMetrics(dashboard);
  const breaches = exceptions().filter(
    (e) => !e.explained && (includesAll || metricIds.has(e.metricId)),
  );
  if (breaches.length > 0) {
    return { ok: false, status: 422, code: "UNEXPLAINED_VARIANCE", breaches };
  }

  const latest = latestClosedPeriod(state.points);
  const relevantMetricIds = includesAll
    ? new Set(state.metricDefs.map((d) => d.id))
    : metricIds;
  const narrativeIds = state.narratives
    .filter((n) => n.period === latest && relevantMetricIds.has(n.metricId))
    .map((n) => n.id);

  const pack: BoardPack = {
    id: nextId("pack"),
    dashboardId,
    publishedAt: new Date().toISOString(),
    blockIds: dashboard.blocks.map((b) => b.id),
    narrativeIds,
  };
  state.packs.push(pack);
  return { ok: true, pack };
}
