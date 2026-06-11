/**
 * CellModel — single source of truth for Coverage-tab cell rendering.
 *
 * Replaces scattered inline derivation logic with one pure function
 * (`buildCellModel`) that computes every value a cell needs to render:
 * per-depth test levels, achieved/ceiling depths, chip color, and
 * regression flag.
 */

import type {
  LiveStatusMap,
  StatusRow,
  State,
  PoolCommError,
  FleetSurfaceState,
} from "./live-status";
import {
  keyFor,
  CATALOG_TO_D5_KEY,
  commErrorFromStatusSignal,
} from "./live-status";
import { E2E_STALE_AFTER_MS, D4_STALE_AFTER_MS, isStale } from "./staleness";

// Re-export the staleness windows so existing consumers that import them from
// this module (e.g. `cell-model.test.ts`) keep resolving — the canonical
// definitions now live in `./staleness`.
export {
  E2E_STALE_AFTER_MS,
  D4_STALE_AFTER_MS,
  LIVENESS_STALE_AFTER_MS,
} from "./staleness";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TestStatus = "green" | "red" | "amber" | null;
export type ChipColor = "green" | "amber" | "red" | "gray";

export interface TestLevel {
  exists: boolean;
  status: TestStatus;
  row: StatusRow | null;
}

export interface CellModel {
  supported: boolean;
  d3: TestLevel | null;
  d4: TestLevel | null;
  d5: TestLevel | null;
  d6: TestLevel | null;
  /**
   * Ladder-gated D6 status — the value the D6 badge and D6 stat MUST consume
   * (NOT the raw per-dimension `d6.status`). D6 is the top of the verification
   * ladder, so a green D6 claim is only valid when the ladder through D5 is
   * intact. When the ladder is broken/unverified below D6 (D1-D4 gate fails, or
   * D5 is red/amber/no-data), the raw D6 result is meaningless as a top-of-ladder
   * claim, so this collapses to `null` (blocked/not-achieved — rendered gray/—,
   * NOT a false green and NOT a false red; the actual lower-rung failure is
   * already shown by the CV/API/RT badges). When the ladder IS intact through D5,
   * the raw D6 status passes through (a genuine D6 red still surfaces as red).
   *
   * D5-UNMAPPED EXCEPTION (`!d5.exists`): when D5 is not mapped for this feature
   * there is no D5 rung to gate against, so the raw `d6.status` passes through
   * unchanged (a present failing D6 still surfaces — this mirrors the chip's
   * `!d5.exists` branch, which goes red on a non-green D6). Only a PRESENT but
   * non-green / no-data D5 collapses D6 to `null`.
   *
   * Derived from the SAME contiguous-ladder algorithm as `chipColor` so the
   * badge, the stat, and the chip never disagree. When the ladder is intact
   * through D5 (`d5.status === "green"`, gate passing), `d6Effective` passes the
   * RAW `d6.status` straight through, so it tracks the actual D6 result while
   * the chip collapses every non-green D6 to amber:
   *   D5 green + D6 green          → chip green, d6Effective green
   *   D5 green + D6 red            → chip amber, d6Effective RED
   *   D5 green + D6 amber          → chip amber, d6Effective amber
   *   D5 green + D6 missing/null   → chip amber, d6Effective null
   *   gate fails / D5 broken/null  → chip red or gray, d6Effective null (blocked)
   * The chip is the coarser of the two: amber covers ANY non-green D6 once the
   * ladder is intact, whereas d6Effective preserves the underlying D6 colour
   * (a genuine D6 red surfaces as red on the badge/stat).
   */
  d6Effective: TestStatus;
  achievedDepth: 0 | 3 | 4 | 5 | 6;
  ceilingDepth: 0 | 3 | 4 | 5 | 6;
  chipColor: ChipColor;
  isRegression: boolean;
  /**
   * Pool COMMUNICATION error (REQ-B), decoded from a status row's signal under
   * `FLEET_COMM_ERROR_SIGNAL_KEY`, when the latest attempt failed to reach /
   * trust the worker pool rather than producing a real test result. This is a
   * SEPARATE overlay from the probe colour — `chipColor` keeps carrying the
   * last-known result so the cell still shows its prior state, dimmed, while
   * `surfaceState` flips to `"unreachable"` so the renderer can paint the
   * distinct "couldn't reach the pool" treatment. `undefined` when the pool was
   * reachable (the normal case — a real red is NOT a comm error).
   */
  commError?: PoolCommError;
  /**
   * The dashboard's presentation state. Lets the renderer branch on ONE value
   * instead of re-deriving the comm-error precedence. A presentation field
   * only — never persisted. The derivation produces THREE outcomes:
   *   - `"unreachable"` — a `commError` of a directly-observed crash kind
   *     (`worker-crashed-mid-job`, `worker-unreachable`, …) is present: paint
   *     the red comm-error overlay.
   *   - `"pending"` — a `worker-reclaimed-pending` commError is present on a
   *     healthy/no-data (green/gray, non-regressed) cell: a lease lapsed and
   *     the job was re-queued (routine teardown, not a known crash), so render
   *     the neutral gray "pending" surface.
   *   - the cell's underlying probe colour (mapped from `chipColor`) — no
   *     commError, OR a `worker-reclaimed-pending` commError that must NOT mask
   *     a red/amber/regressed probe result (any genuine failure passes
   *     through; only green/gray becomes "pending").
   */
  surfaceState: FleetSurfaceState;
}

export interface CellModelInput {
  slug: string;
  featureId: string;
  isSupported: boolean;
  isWired: boolean;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Map PocketBase State → TestStatus. */
function stateToTestStatus(state: State): TestStatus {
  switch (state) {
    case "green":
      return "green";
    case "red":
      return "red";
    case "degraded":
      return "amber";
    default: {
      const _exhaustive: never = state;
      void _exhaustive;
      return null;
    }
  }
}

/** Rank for worst-state comparison: higher = worse. */
const STATE_RANK: Readonly<Record<State, number>> = {
  red: 3,
  degraded: 2,
  green: 1,
};

/**
 * Worst-state rank for an arbitrary row state (Fix A2). `StatusRow.state` is
 * typed `State` (green|red|degraded), but the harness CAN persist an
 * out-of-vocabulary value at runtime — notably `"error"` (the no-data
 * representation; see harness result-aggregator.ts). A bare `STATE_RANK[state]`
 * for such a value is `undefined`, and the fold comparison `undefined > n` is
 * `false`, so the row is SILENTLY DROPPED from the worst-state fold instead of
 * surfacing. Treat an unknown state as the MOST SEVERE (a rank above every known
 * state) so it surfaces as the worst rather than vanishing — an unrecognized
 * signal must never be silently swallowed.
 */
const UNKNOWN_STATE_RANK = Number.POSITIVE_INFINITY;
function rankOfState(state: string): number {
  return STATE_RANK[state as State] ?? UNKNOWN_STATE_RANK;
}

/**
 * Map State → TestStatus for the D5/D6 rank-fold resolvers. Differs from
 * `stateToTestStatus` ONLY for an out-of-vocabulary runtime state (e.g.
 * "error" — see `rankOfState`): the A2 rank fold deliberately surfaces such a
 * state as the WORST in the family, so mapping it to `null` here would swallow
 * the fold winner one step later — the D5/D6 chip/badge would render benign
 * gray no-data while live-status's badge path renders the loud "error" tone
 * for the same row. Map it to "red" (the failing status) so an unrecognized
 * state can never present as no-data on D5/D6.
 *
 * D3/D4 keep the base `stateToTestStatus` mapping: their `null` is rescued by
 * the chip's D1-D4 gate check (`exists && status !== "green"` → gate fails →
 * red), so an unknown state can never present as healthy there — see the
 * decision table in `buildCellModel`.
 */
function foldStateToTestStatus(state: State): TestStatus {
  return stateToTestStatus(state) ?? "red";
}

/**
 * Resolve the D4 (real-time) test level for `slug`.
 *
 * D4 checks both `chat:<slug>` and `tools:<slug>`. When both exist the
 * worst-state wins — a green chat + red tools yields red D4, not green.
 *
 * Staleness applies the same downgrade as `resolveD3`, but PER ROW and
 * BEFORE the worst-state fold (mirroring `resolveD5`): a green chat/tools
 * row whose `observed_at` is older than `D4_STALE_AFTER_MS` is treated as
 * `degraded` while folding. Folding raw states first would let a fresh-green
 * row win the all-green tie and hide a stale-green sibling, re-introducing
 * the false-green. Only green is downgraded; a stale red/degraded row already
 * signals a problem.
 */
function resolveD4(live: LiveStatusMap, slug: string, now: number): TestLevel {
  const chatRow = live.get(keyFor("chat", slug)) ?? null;
  const toolsRow = live.get(keyFor("tools", slug)) ?? null;

  if (!chatRow && !toolsRow) {
    return { exists: false, status: null, row: null };
  }

  // Fold to the worst effective state across present rows, applying the
  // per-row stale-green→degraded downgrade before comparing. The winner row
  // is stored in its EFFECTIVE (downgraded) form so `.row.state` agrees with
  // `.status` — mirroring `buildBadge` in live-status.ts, whose returned
  // `.row` is the effective row.
  let winner: StatusRow | null = null;
  let worstState: State | null = null;
  for (const candidate of [chatRow, toolsRow]) {
    if (!candidate) continue;
    const effectiveState: State =
      candidate.state === "green" && isStale(candidate, now, D4_STALE_AFTER_MS)
        ? "degraded"
        : candidate.state;
    if (
      worstState === null ||
      rankOfState(effectiveState) > rankOfState(worstState)
    ) {
      winner =
        effectiveState === candidate.state
          ? candidate
          : { ...candidate, state: effectiveState };
      worstState = effectiveState;
    }
  }

  if (!winner || worstState === null) {
    // Both rows present-checked above, so this is unreachable in practice;
    // guard anyway instead of asserting (mirrors resolveD5/resolveD6).
    return { exists: true, status: null, row: null };
  }

  return {
    exists: true,
    status: stateToTestStatus(worstState),
    row: winner,
  };
}

/**
 * Resolve the D5 (conversation verification) test level for
 * `(slug, featureId)`.
 *
 * Uses `CATALOG_TO_D5_KEY` to map catalog feature IDs to D5 PB row key
 * suffixes. When multiple sub-keys exist (e.g. `beautiful-chat` fans out
 * to 5 pills), worst-state wins.
 *
 * Staleness applies the same downgrade as `resolveD3`, but PER SUB-ROW and
 * BEFORE the worst-state fold: a green D5 sub-row whose `observed_at` is
 * older than `E2E_STALE_AFTER_MS` is treated as `degraded` while folding.
 * This matters because `green` is the LOWEST rank — folding raw states first
 * would let a fresh-green sub-row win the all-green tie and hide a stale-green
 * sibling, re-introducing the false-green. Downgrading each green-but-stale
 * sub-row first means ANY stale-green sub-row forces the family to amber,
 * independent of `CATALOG_TO_D5_KEY` order. Only green is downgraded; a stale
 * red/degraded sub-row already signals a problem.
 *
 * STRICT on missing sub-rows: a multi-key family is credited green ONLY when
 * EVERY mapped sub-row is present and green-and-fresh — a missing mapped
 * sub-row forces the family out of green and resolves to `status: null`
 * (no-data/unverified), so `achievedDepth` caps below 5 and the chip renders
 * gray. A present RED sub-row still yields red (red dominates no-data). This
 * matches `depth-utils.ts` `isD5Green`, which uses `d5Keys.every(...)`; both
 * consumers now agree on partial-emission handling.
 */
function resolveD5(
  live: LiveStatusMap,
  slug: string,
  featureId: string,
  now: number,
): TestLevel {
  const d5Keys = CATALOG_TO_D5_KEY[featureId];

  // No mapping → test doesn't exist for this feature.
  if (!d5Keys || d5Keys.length === 0) {
    return { exists: false, status: null, row: null };
  }

  let worstRow: StatusRow | null = null;
  let worstState: State | null = null;
  let anyMissing = false;
  for (const d5Key of d5Keys) {
    const row = live.get(keyFor("d5", slug, d5Key)) ?? null;
    if (!row) {
      // STRICT: a missing mapped sub-row means the family is unverified —
      // it can no longer be credited green. Mirrors `isD5Green`'s
      // `every(...)` in depth-utils.ts so both consumers agree.
      anyMissing = true;
      continue;
    }
    // Per-row staleness downgrade applied BEFORE the fold: a green sub-row
    // that is stale folds in as `degraded` so it can never win the all-green
    // tie and mask a fresh-green sibling.
    const effectiveState: State =
      row.state === "green" && isStale(row, now, E2E_STALE_AFTER_MS)
        ? "degraded"
        : row.state;
    if (
      worstState === null ||
      rankOfState(effectiveState) > rankOfState(worstState)
    ) {
      // Store the EFFECTIVE (downgraded) row so `.row.state` agrees with
      // `.status` — mirrors `buildBadge` in live-status.ts.
      worstRow =
        effectiveState === row.state ? row : { ...row, state: effectiveState };
      worstState = effectiveState;
    }
  }

  if (!worstRow || worstState === null) {
    // Keys are mapped but no rows emitted yet — test exists but has no
    // data. Treat as exists=true so ceilingDepth reflects it.
    return { exists: true, status: null, row: null };
  }

  // STRICT missing-sub-row handling: when a mapped sub-row is absent the
  // family is unverified. A present RED sub-row still signals a real failure
  // (red dominates no-data), but a present green/degraded fold must NOT be
  // credited — collapse it to no-data (status: null) so achievedDepth caps
  // below 5 and the chip renders gray, not a false-green/amber. RANK-based,
  // not `!== "red"` literal equality: `worstState` is typed `State` but can
  // hold an out-of-vocabulary runtime value (e.g. "error"), which the A2 rank
  // machinery deliberately ranks ABOVE red — literal equality would silently
  // swallow exactly the state the rank fold exists to surface. Mirrors
  // resolveD5Row/resolveD6Row in live-status.ts.
  if (anyMissing && rankOfState(worstState) < STATE_RANK.red) {
    return { exists: true, status: null, row: null };
  }

  return {
    exists: true,
    status: foldStateToTestStatus(worstState),
    row: worstRow,
  };
}

/**
 * Resolve the D3 (API / e2e) test level for `(slug, featureId)`.
 *
 * A green e2e row that has not been refreshed within `E2E_STALE_AFTER_MS`
 * is downgraded to `amber` (degraded): the driver has stopped writing, so
 * the frozen-green row is no longer trustworthy evidence of health. Only
 * green is downgraded — a stale red/degraded row already signals a problem
 * and is left as-is.
 *
 * PRODUCER-INVARIANT ASSUMPTION: the implicit D1/D2 gate is enforced
 * upstream, not here — this resolver credits D3 from the `e2e:<slug>/<feature>`
 * row ALONE and never consults the `health:<slug>`/`agent:<slug>` rows. The
 * e2e driver is expected not to emit green when liveness is red.
 */
function resolveD3(
  live: LiveStatusMap,
  slug: string,
  featureId: string,
  now: number,
): TestLevel {
  const row = live.get(keyFor("e2e", slug, featureId)) ?? null;
  if (!row) {
    return { exists: false, status: null, row: null };
  }
  if (row.state === "green" && isStale(row, now, E2E_STALE_AFTER_MS)) {
    return { exists: true, status: "amber", row };
  }
  return {
    exists: true,
    status: stateToTestStatus(row.state),
    row,
  };
}

/**
 * Resolve the D6 (parity-vs-reference) test level for `(slug, featureId)`.
 *
 * D6 is PER-CELL, not an integration aggregate. The `e2e-parity` driver
 * emits one `d6:<slug>/<featureType>` row per featureType (mirroring D5's
 * keyspace — both fan out over `demosToFeatureTypes`), PLUS a single
 * integration-level aggregate `d6:<slug>` row. The aggregate is red whenever
 * ANY cell fails, so resolving cells against it would paint genuinely-green
 * cells red. This resolver therefore reads the PER-CELL row, mapped through
 * `CATALOG_TO_D5_KEY` (the same catalog-featureId → featureType bridge D5
 * uses); the aggregate `d6:<slug>` row no longer drives per-cell rendering.
 *
 * Mirrors `resolveD5` exactly:
 *
 * Staleness applies the same downgrade as `resolveD3`, but PER SUB-ROW and
 * BEFORE the worst-state fold: a green D6 sub-row whose `observed_at` is older
 * than `E2E_STALE_AFTER_MS` is treated as `degraded` while folding, so a
 * fresh-green sub-row can never win the all-green tie and mask a stale-green
 * sibling. Only green is downgraded; a stale red/degraded sub-row already
 * signals a problem.
 *
 * STRICT on missing sub-rows: a multi-key family is credited green ONLY when
 * EVERY mapped sub-row is present and green-and-fresh — a missing mapped
 * sub-row forces the family out of green and resolves to `status: null`
 * (no-data/unverified). A present RED sub-row still yields red (red dominates
 * no-data). This matches `depth-utils.ts` `isD6Green`, which uses
 * `d6Keys.every(...)`, and the identical handling in `resolveD5`.
 */
function resolveD6(
  live: LiveStatusMap,
  slug: string,
  featureId: string,
  now: number,
): TestLevel {
  const d6Keys = CATALOG_TO_D5_KEY[featureId];

  // No mapping → test doesn't exist for this feature.
  if (!d6Keys || d6Keys.length === 0) {
    return { exists: false, status: null, row: null };
  }

  let worstRow: StatusRow | null = null;
  let worstState: State | null = null;
  let anyMissing = false;
  for (const d6Key of d6Keys) {
    const row = live.get(keyFor("d6", slug, d6Key)) ?? null;
    if (!row) {
      // STRICT: a missing mapped sub-row means the family is unverified —
      // it can no longer be credited green. Mirrors `isD6Green`'s
      // `every(...)` in depth-utils.ts so both consumers agree.
      anyMissing = true;
      continue;
    }
    // Per-row staleness downgrade applied BEFORE the fold: a green sub-row
    // that is stale folds in as `degraded` so it can never win the all-green
    // tie and mask a fresh-green sibling.
    const effectiveState: State =
      row.state === "green" && isStale(row, now, E2E_STALE_AFTER_MS)
        ? "degraded"
        : row.state;
    if (
      worstState === null ||
      rankOfState(effectiveState) > rankOfState(worstState)
    ) {
      // Store the EFFECTIVE (downgraded) row so `.row.state` agrees with
      // `.status` — mirrors `buildBadge` in live-status.ts.
      worstRow =
        effectiveState === row.state ? row : { ...row, state: effectiveState };
      worstState = effectiveState;
    }
  }

  if (!worstRow || worstState === null) {
    // Keys are mapped but no rows emitted yet — test exists but has no
    // data. Treat as exists=true so ceilingDepth reflects it.
    return { exists: true, status: null, row: null };
  }

  // STRICT missing-sub-row handling: when a mapped sub-row is absent the
  // family is unverified. A present RED sub-row still signals a real failure
  // (red dominates no-data), but a present green/degraded fold must NOT be
  // credited — collapse it to no-data (status: null) so the chip renders
  // gray/amber per the ladder, not a false-green. RANK-based, not `!== "red"`
  // literal equality: `worstState` is typed `State` but can hold an
  // out-of-vocabulary runtime value (e.g. "error"), which the A2 rank
  // machinery deliberately ranks ABOVE red — literal equality would silently
  // swallow exactly the state the rank fold exists to surface. Mirrors
  // resolveD5Row/resolveD6Row in live-status.ts.
  if (anyMissing && rankOfState(worstState) < STATE_RANK.red) {
    return { exists: true, status: null, row: null };
  }

  return {
    exists: true,
    status: foldStateToTestStatus(worstState),
    row: worstRow,
  };
}

/**
 * Map a derived `ChipColor` onto the presentation surface state. `FleetSurfaceState`
 * is `ChipColor | "unreachable"`, so every chip colour passes straight through;
 * the `"unreachable"` overlay is applied separately by the caller when a comm
 * error is present. Pure; no widening cast needed.
 */
function chipColorToSurface(color: ChipColor): FleetSurfaceState {
  return color;
}

/**
 * Decode a pool comm-error (REQ-B) for this cell by scanning the status rows
 * the cell's overlay depends on: the per-cell D6 (parity) row family, D5
 * (conversation), the D3/e2e row, the D4 (chat/tools) rows, health, AND the
 * integration-level d6 AGGREGATE row (`d6:<slug>`). The control-plane mirrors a
 * `PoolCommError` into the row signal under `FLEET_COMM_ERROR_SIGNAL_KEY` (see
 * `commErrorFromStatusSignal`).
 *
 * KIND SEVERITY — not key order, and NOT recency — decides the winner; recency
 * is only a within-tier tie-break (flap-band #70/FF5). Multiple rows can each
 * carry a comm error simultaneously (e.g. a STALE per-cell comm error left over
 * from an earlier attempt, plus an error that landed solely on the aggregate
 * row). A directly-observed crash kind (`worker-crashed-mid-job`,
 * `worker-unreachable`, every non-reclaim kind) is a HARD failure the
 * worker/control-plane saw first-hand and OUT-RANKS the sweep-inferred
 * `worker-reclaimed-pending` (a lease lapsed / job re-queued — which cannot tell
 * a real crash from a routine teardown). A NEWER reclaim must therefore NOT mask
 * an OLDER real crash. So we decode EVERY candidate row and return the
 * highest-SEVERITY comm error, using the most recent `observedAt` only to break
 * ties WITHIN a severity tier and falling back to scan order when timestamps are
 * equal/absent (stable tie-break). Returns `undefined` when no candidate row
 * carries a comm error (pool reachable).
 *
 * STALENESS WINDOW: a comm error is only surfaced while it is RECENT. The
 * control-plane mirrors a `PoolCommError` onto the `d6:<slug>` aggregate row but
 * NOTHING clears that blob on recovery — recovery just writes fresh green
 * per-cell rows. Without an age cap a single comm error would pin every cell of
 * the service to "unreachable" forever, even after the pool recovers. So a
 * decoded comm error whose `observedAt` is older than `E2E_STALE_AFTER_MS` (the
 * same window resolveD3/D5/D6 apply to stale-green rows; the comm error rides the
 * e2e-cadence d6 aggregate) is treated as recovered and skipped — exactly mirror-
 * ing the resolveDx stale-green downgrade. `now` is threaded in the same way
 * buildCellModel passes it to the resolveDx resolvers.
 *
 * SCOPE NOTE: this intentionally scans the integration-scoped aggregate
 * (`d6:<slug>`) and the chat/tools/health rows in addition to the cell's own
 * per-cell rows. A worker-death comm error rides on the aggregate row, not the
 * per-cell rows, so to surface the "unreachable" overlay at all the cell MUST
 * consult the aggregate — which means every cell of the affected service lights
 * up from that one aggregate signal. That is the intended behavior (a pool that
 * can't be reached cannot have produced any per-cell result), not a leak from "a
 * row the cell doesn't show".
 */
function decodeCellCommError(
  live: LiveStatusMap,
  slug: string,
  featureId: string,
  now: number,
): PoolCommError | undefined {
  // Per-cell D6/D5 rows fan out over the mapped featureType family.
  const familyKeys = CATALOG_TO_D5_KEY[featureId];
  const candidateKeys: string[] = [];
  if (familyKeys) {
    for (const ft of familyKeys) {
      candidateKeys.push(keyFor("d6", slug, ft));
      candidateKeys.push(keyFor("d5", slug, ft));
    }
  }
  // The d6 AGGREGATE row (`d6:<slug>`, no featureId) is where BOTH harness
  // legs mirror a per-service `PoolCommError` (REQ-B): the result-aggregator
  // overlays it onto the aggregate primary row (`result.aggregateKey` =
  // `d6:<slug>`), and the control-plane fleet-health leg writes it to the job's
  // `probe_key` (also `d6:<slug>`). Without scanning the aggregate key here the
  // dashboard never surfaces the "unreachable" overlay even though the signal
  // is persisted. Checked alongside the per-cell rows so a worker-death comm
  // error lights up every cell of the affected service.
  candidateKeys.push(keyFor("d6", slug));
  candidateKeys.push(keyFor("e2e", slug, featureId));
  candidateKeys.push(keyFor("chat", slug));
  candidateKeys.push(keyFor("tools", slug));
  candidateKeys.push(keyFor("health", slug));

  // Decode every candidate and keep the WORST comm error, ranking by KIND
  // SEVERITY first and using recency only as a same-severity tie-break. A
  // directly-observed crash (`worker-crashed-mid-job`, `worker-unreachable`,
  // every non-reclaim kind) is a HARD failure the worker/control-plane saw
  // first-hand; `worker-reclaimed-pending` is only the sweep boundary's
  // inference (a lease lapsed, job re-queued) and cannot tell a real crash from
  // a routine teardown. So a NEWER reclaim must NOT out-rank an OLDER real
  // crash — severity is the primary winner key, recency only the tie-break
  // WITHIN a tier. Within the same tier a later candidate wins only when its
  // `observedAt` is strictly newer, so for equal/absent timestamps the
  // first-in-scan-order error is retained (stable tie-break).
  let winner: PoolCommError | undefined;
  let winnerSeverity = Number.NEGATIVE_INFINITY;
  let winnerTs = Number.NEGATIVE_INFINITY;
  for (const key of candidateKeys) {
    const row = live.get(key);
    if (!row) continue;
    const commError = commErrorFromStatusSignal(row.signal);
    if (!commError) continue;
    // `observedAt` is an ISO string; `Date.parse` yields NaN for a malformed
    // value.
    const parsed = Date.parse(commError.observedAt);
    // STALENESS GATE: a comm error older than the staleness window is treated
    // as recovered and skipped — nothing clears the mirrored blob on recovery,
    // so without this the cell would render "unreachable" forever. Mirrors the
    // resolveDx stale-green downgrade. An UNPARSEABLE `observedAt` (NaN) is
    // treated as stale too: it can never be cleared on recovery (its age is
    // undefined), so surfacing it would strand a permanent phantom overlay.
    if (Number.isNaN(parsed) || now - parsed > E2E_STALE_AFTER_MS) {
      continue;
    }
    // Severity tier: directly-observed crash kinds (everything except the
    // sweep-inferred reclaim) outrank `worker-reclaimed-pending`.
    const severity = commError.kind === "worker-reclaimed-pending" ? 0 : 1;
    if (
      winner === undefined ||
      severity > winnerSeverity ||
      (severity === winnerSeverity && parsed > winnerTs)
    ) {
      winner = commError;
      winnerSeverity = severity;
      winnerTs = parsed;
    }
  }
  return winner;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const NOT_WIRED_LEVEL: TestLevel = { exists: false, status: null, row: null };

const UNSUPPORTED: CellModel = {
  supported: false,
  d3: null,
  d4: null,
  d5: null,
  d6: null,
  d6Effective: null,
  achievedDepth: 0,
  ceilingDepth: 0,
  chipColor: "gray",
  isRegression: false,
  surfaceState: "gray",
};

/**
 * Build the complete cell model for a single (integration, feature) pair.
 *
 * This is the ONLY function that should derive cell rendering state —
 * every Coverage-tab component should call this instead of doing inline
 * resolution.
 */
export function buildCellModel(
  live: LiveStatusMap,
  input: CellModelInput,
  now: number = Date.now(),
): CellModel {
  const { slug, featureId, isSupported, isWired } = input;

  // ── Unsupported cell ──────────────────────────────────────────────
  if (!isSupported) {
    return UNSUPPORTED;
  }

  // ── Not wired (supported but no test harness configured) ──────────
  if (!isWired) {
    return {
      supported: true,
      d3: NOT_WIRED_LEVEL,
      d4: NOT_WIRED_LEVEL,
      d5: NOT_WIRED_LEVEL,
      d6: NOT_WIRED_LEVEL,
      d6Effective: null,
      achievedDepth: 0,
      ceilingDepth: 0,
      chipColor: "gray",
      isRegression: false,
      surfaceState: "gray",
    };
  }

  // ── Wired + supported: resolve each depth independently ───────────
  const d3 = resolveD3(live, slug, featureId, now);
  const d4 = resolveD4(live, slug, now);
  const d5 = resolveD5(live, slug, featureId, now);
  const d6 = resolveD6(live, slug, featureId, now);

  // ceilingDepth: highest CONTIGUOUS depth where a test EXISTS.
  // D4 only counts if D3 exists; D5 only counts if D4 counts; D6 only
  // counts if D5 counts.
  let ceilingDepth: 0 | 3 | 4 | 5 | 6 = 0;
  if (d3.exists) {
    ceilingDepth = 3;
    if (d4.exists) {
      ceilingDepth = 4;
      if (d5.exists) {
        ceilingDepth = 5;
        if (d6.exists) ceilingDepth = 6;
      }
    }
  }

  // achievedDepth: highest CONTIGUOUS passing depth.
  // D3 must pass before D4 counts, D4 before D5, D5 before D6.
  let achievedDepth: 0 | 3 | 4 | 5 | 6 = 0;
  if (d3.status === "green") {
    achievedDepth = 3;
    if (d4.status === "green") {
      achievedDepth = 4;
      if (d5.status === "green") {
        achievedDepth = 5;
        if (d6.status === "green") {
          achievedDepth = 6;
        }
      }
    }
  }

  // chipColor derivation — contiguous-ladder algorithm.
  //
  // Green is the strict reward for an INTACT verification ladder; a higher
  // level (D6) can never paint over a broken/unverified lower level (D5).
  // NOTE: D1/D2 (liveness) failure causes D3 (e2e-demos) to also fail, so
  // checking d3.status implicitly covers the D1/D2 gate.
  //
  // Decision table over (d1d4GateFails, d5.exists, d5.status, d6.status):
  //   gate fails                                  → red  (gate dominates)
  //   D5 unmapped (!d5.exists), no D6             → gray (ceiling is D4)
  //   D5 green + D6 green                         → green
  //   D5 green + D6 red/amber/missing             → amber
  //   D5 red/amber + (any D6)                     → red  (broken ladder)
  //   D5 null  + D6 red                           → red
  //   D5 null  + D6 green/amber/missing           → gray (unverified ladder)
  const d1d4GateFails =
    (d3.exists && d3.status !== "green") ||
    (d4.exists && d4.status !== "green");

  let chipColor: ChipColor;
  if (d1d4GateFails) {
    // A failing/stale D1-D4 gate dominates everything below it.
    chipColor = "red";
  } else if (!d5.exists) {
    // D5 is not mapped for this feature → ceiling is D4 and D6 is not its
    // gate. Green requires a contiguous D5, so an unmapped D5 never paints
    // green. With the gate passing this resolves to gray (cell sits at its
    // D4 ceiling with no further verification), unless a present D6 row is
    // explicitly failing — which still surfaces as red.
    chipColor = d6.exists && d6.status !== "green" ? "red" : "gray";
  } else if (d5.status === "green") {
    // Mapped D5 is green → ladder intact up to D5. D6 decides green vs amber.
    chipColor = d6.status === "green" ? "green" : "amber";
  } else if (d5.status === null) {
    // Mapped D5 has no data → ladder unverified. A red D6 still signals a
    // real failure; otherwise treat as no-data (gray), never green.
    chipColor = d6.status === "red" ? "red" : "gray";
  } else {
    // Mapped D5 is red or stale-amber → ladder broken at D5. Red wins over
    // any D6 outcome (including a green aggregate).
    chipColor = "red";
  }

  // d6Effective — ladder-gated D6 status for the D6 badge + D6 stat.
  //
  // D6 is the TOP of the verification ladder, so a green D6 claim is only
  // meaningful when the ladder through D5 is intact. This reuses the SAME
  // ladder predicates the chip uses above (`d1d4GateFails`, `d5.status`) so the
  // badge/stat never contradict the chip:
  //   gate fails              → null (blocked; API/RT badge shows the failure)
  //   D5 not mapped (!exists) → raw d6.status (D6 is not D5's gate here; a
  //                             present failing D6 still surfaces — matches the
  //                             chip's `!d5.exists` branch which goes red on a
  //                             non-green D6)
  //   D5 green                → raw d6.status (ladder intact through D5; a
  //                             genuine D6 red/amber/green passes through)
  //   D5 red/amber/null       → null (ladder BROKEN/unverified below D6 → the
  //                             D6 claim is not-achieved/blocked; never a false
  //                             green and never a false red — the CV badge
  //                             already shows the real lower-rung failure)
  let d6Effective: TestStatus;
  if (d1d4GateFails) {
    d6Effective = null;
  } else if (!d5.exists) {
    d6Effective = d6.status;
  } else if (d5.status === "green") {
    d6Effective = d6.status;
  } else {
    // D5 red, stale-amber, or no-data → ladder not intact through D5.
    d6Effective = null;
  }

  // isRegression: a cell has slid below its own ceiling. Beyond
  // `achievedDepth < ceilingDepth`, the NEXT rung above `achievedDepth` must
  // have EMITTED data — `exists && status !== null` — for the slide-back to
  // be real. A mapped-but-unemitted D5 (e.g. achieved=4, ceiling=5, but
  // `d5.status === null` because no d5 rows have ticked) is no-data, not a
  // regression: flagging it would paint every D5-mapped cell amber the moment
  // its D5 driver hasn't run yet. A present RED/AMBER next rung (status !==
  // null) still counts — that is a genuine failure below the ceiling.
  //
  // Next-rung map by achievedDepth: 0→d3, 3→d4, 4→d5, 5→d6.
  //
  // The D6 rung uses the LADDER-GATED `d6Effective` (NOT raw `d6.status`) so the
  // regression flag agrees with the rendered gated D6 badge. When achievedDepth
  // is already 5 the ladder is intact through D5, so d6Effective passes the raw
  // d6.status through — this is behavior-preserving for the active case — but
  // sourcing the gated value keeps the regression flag, the badge, and the chip
  // from ever disagreeing about D6.
  const d6EffectiveRung: TestLevel = { ...d6, status: d6Effective };
  const nextRung: TestLevel | null =
    achievedDepth === 0
      ? d3
      : achievedDepth === 3
        ? d4
        : achievedDepth === 4
          ? d5
          : achievedDepth === 5
            ? d6EffectiveRung
            : null;
  const isRegression =
    ceilingDepth > 0 &&
    achievedDepth < ceilingDepth &&
    nextRung !== null &&
    nextRung.exists &&
    nextRung.status !== null;

  // ── Pool comm-error overlay (REQ-B + flap-band #70) ───────────────
  // Decode "couldn't reach the pool" off the rows this cell reads. When
  // present it does NOT overwrite chipColor — the cell keeps showing its
  // last-known probe result; surfaceState flips to an overlay so the renderer
  // paints the distinct comm-error treatment on top.
  //
  // The overlay surface depends on the comm-error KIND:
  //   - `worker-reclaimed-pending`: a lease lapsed and the sweeper re-queued the
  //     job (back in flight). The sweep boundary cannot tell a real crash from an
  //     expected platform teardown, so this is NEUTRAL — render "pending" (gray),
  //     never red. This is the flap-band #70 fix: a routine Railway teardown no
  //     longer flaps the whole service red.
  //   - every other kind (worker-crashed-mid-job, worker-unreachable, …): a
  //     KNOWN comm failure the worker/control-plane observed directly — render
  //     the red "unreachable" overlay as before.
  const commError = decodeCellCommError(live, slug, featureId, now);
  const surfaceState: FleetSurfaceState = commError
    ? commError.kind === "worker-reclaimed-pending"
      ? // A reclaimed-pending overlay is NEUTRAL (gray "pending") ONLY when the
        // cell's real probe result is healthy (green) or no-data (gray) and not
        // a regression. ANY failure colour — red OR amber (partial failure /
        // degraded ladder) — or a regression below the ceiling is a GENUINE
        // failure that the neutral pending overlay must NOT mask (mirrors the
        // harness fleetSurfaceState: only green becomes "pending"; every
        // non-green failure state passes through) — otherwise DepthChip's
        // "pending" early-return would hide a real failure. The failure colour
        // wins; routine teardown (green/gray) still shows gray.
        chipColor === "red" || chipColor === "amber" || isRegression
        ? chipColorToSurface(chipColor)
        : "pending"
      : "unreachable"
    : chipColorToSurface(chipColor);

  return {
    supported: true,
    d3,
    d4,
    d5,
    d6,
    d6Effective,
    achievedDepth,
    ceilingDepth,
    chipColor,
    isRegression,
    ...(commError ? { commError } : {}),
    surfaceState,
  };
}
