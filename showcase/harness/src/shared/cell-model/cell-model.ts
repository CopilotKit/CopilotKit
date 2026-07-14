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
} from "./live-status.js";
import {
  keyFor,
  CATALOG_TO_D5_KEY,
  commErrorFromStatusSignal,
  FLEET_COMM_AGGREGATE_DIMENSIONS,
  STARTER_LEVELS,
} from "./live-status.js";
import type { StarterLevel } from "./live-status.js";
import {
  E2E_STALE_AFTER_MS,
  D4_STALE_AFTER_MS,
  LIVENESS_STALE_AFTER_MS,
  STARTER_STALE_AFTER_MS,
  isStale,
} from "./staleness.js";

// Re-export the staleness windows so existing consumers that import them from
// this module (e.g. `__tests__/cell-model.test.ts`) keep resolving — the
// canonical definitions now live in `./staleness`.
export {
  E2E_STALE_AFTER_MS,
  D4_STALE_AFTER_MS,
  LIVENESS_STALE_AFTER_MS,
} from "./staleness.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TestStatus = "green" | "red" | "amber" | null;
export type ChipColor = "green" | "amber" | "red" | "gray";

/**
 * INFRA error classes that fold a red cell to gray (U7, spec §7.1).
 *
 * The harness writes an `errorClass`/`errorDesc` literal onto a failing row's
 * `signal` blob. Two of those literals mean the probe NEVER produced a real
 * functional result — the run was infra-broken, not product-broken:
 *   - `driver-error` — the Playwright driver threw before/while exercising the
 *     feature (`d6-all-pills.ts` non-abort catch; `d4-chat-roundtrip.ts` writes
 *     it into `errorDesc`, NOT `errorClass`).
 *   - `abort` — the run was aborted by worker drain / shutdown
 *     (`abortSignal.aborted` branch in the same drivers).
 * A cell whose red is attributable ONLY to one of these folds to the existing
 * `gray` ChipColor (no-data) instead of `red`, so an infra blip never
 * masquerades as a genuine product red on the matrix.
 *
 * CONSERVATIVE BY DESIGN (masks-real-red guard, spec R-C / ambiguity #3): the
 * set is EXACTLY these two. Every other emitted class — `feature-timeout`,
 * `missing-script`, `selector-timeout`, `conversation-error`, `goto-error`,
 * `transport-error`, `launcher-error`, `interceptor-attach-error`,
 * `interceptor-stop-error`, `promise-rejected`, `smoke-failed`, … — is a
 * probe that RAN and failed, so it STAYS red. Widening this set risks hiding a
 * genuine failure; never add a class without re-grounding it against the
 * harness drivers. (`comm-error` / `pool-acquire-timeout` are NOT errorClass
 * values — they are the REQ-B comm-error overlay and an Error message
 * respectively — so they will never match here and are deliberately excluded.)
 */
export const INFRA_ERROR_CLASSES: ReadonlySet<string> = new Set([
  "driver-error",
  "abort",
]);

/**
 * Does a status row's `signal` blob carry an INFRA error class in EITHER
 * `errorClass` or `errorDesc`? Reading both fields is mandatory: D4
 * (`d4-chat-roundtrip.ts`) writes `driver-error` into `errorDesc` and leaves
 * `errorClass` unset, so an `errorClass`-only read would leave D4 driver-error
 * reds RED. `signal` is typed `unknown` (the PB blob), so guard the shape
 * before reading — a non-object / array / null signal carries no infra class.
 */
function signalHasInfraErrorClass(signal: unknown): boolean {
  if (signal === null || typeof signal !== "object" || Array.isArray(signal)) {
    return false;
  }
  const blob = signal as Record<string, unknown>;
  const errorClass = blob.errorClass;
  const errorDesc = blob.errorDesc;
  return (
    (typeof errorClass === "string" && INFRA_ERROR_CLASSES.has(errorClass)) ||
    (typeof errorDesc === "string" && INFRA_ERROR_CLASSES.has(errorDesc))
  );
}

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
   * already shown by the 1P/API/BE badges). When the ladder IS intact through D5,
   * the raw D6 status passes through (a genuine D6 red still surfaces as red).
   *
   * D5-UNMAPPED EXCEPTION (`!d5.exists`): when D5 is not mapped for this feature
   * there is no D5 rung to gate against, so the raw `d6.status` passes through
   * unchanged. Because D5 and D6 share the same `CATALOG_TO_D5_KEY` mapping,
   * `!d5.exists` implies `!d6.exists` and the raw status is always `null`
   * today — the passthrough only becomes observable if the two dimensions
   * ever split onto separate maps. Only a PRESENT but non-green / no-data D5
   * collapses D6 to `null`.
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
  /**
   * U8 (§7.2 / §6.4) — is the cell STALE on the matrix? A cell is stale when
   * EVERY row that contributes to its rendering has an `observed_at` older than
   * that row's own family staleness window (so a single fresh row means the
   * cell was recently swept and is NOT stale). Distinct from the per-depth
   * stale-green→amber downgrade in the resolvers: this is a MATRIX-level recency
   * flag that folds ANY stale colour — red INCLUDED — to gray ("re-sweep
   * pending"), because a frozen historical state is no longer a live claim. The
   * same treatment U9's equivalence gate applies (a stale prod row is excluded).
   * `false` for an unsupported/not-wired/no-data cell — there is no observation
   * to be stale.
   */
  isStaleCell: boolean;
  /**
   * U8 — age in milliseconds of the cell's FRESHEST contributing observation
   * (`now - max(observed_at)` across the rows the chip derives from). Surfaces
   * staleness to operators ("last swept N ago"). `null` when the cell has no
   * contributing rows (no-data) — there is no observation to age.
   */
  observedAtAgeMs: number | null;
}

export interface CellModelInput {
  slug: string;
  featureId: string;
  isSupported: boolean;
  isWired: boolean;
  /**
   * Which VERIFICATION AXIS this cell is probed on. Defaults to `"agent"` —
   * the showcase-* integration feature ladder (D3 e2e / D4 chat-tools / D5 / D6,
   * keyed `<dim>:<slug>/<featureId>`). A `"starter"` cell is a starter-template
   * container fleet member (`starter-<slug>`): it is NOT probed on the agent
   * feature ladder at all but on the `starter_smoke` matrix, whose rows are
   * keyed `starter:<column-slug>/<level>` (level ∈ STARTER_LEVELS). For a
   * starter cell `slug` is the DASHBOARD COLUMN slug (the value side of
   * `STARTER_TO_COLUMN`) and `featureId` is a label only (the starter axis is
   * not feature-scoped). `buildCellModel` routes a starter cell to
   * `resolveStarterChip` instead of the agent ladder, so a starter is never
   * resolved from — or emitted as — a phantom `agentic-chat` cell.
   */
  probeAxis?: "agent" | "starter";
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
 * D4 ALSO uses this mapping: its missing-chat collapse resolves to `status:
 * null` (no-data — see `resolveD4`), so the chip's D1-D4 gate treats a null
 * D4 as UNVERIFIED (gray), not failed. An out-of-vocabulary D4 state must
 * therefore map to "red" HERE — it can no longer ride the gate's
 * `!== "green"` catch-all without also painting the no-data collapse red.
 *
 * D3 keeps the base `stateToTestStatus` mapping: a present D3 row never
 * resolves to `null` except for an out-of-vocabulary state, which the chip's
 * D1-D4 gate check (`exists && status !== "green"` → gate fails → red) still
 * rescues — see the decision table in `buildCellModel`.
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
 * EXPECTATION MAPPING (which rows MUST exist — driven by the producer,
 * `d4-chat-roundtrip.ts`):
 *   - `chat:<slug>` is UNCONDITIONAL: the driver writes the L3 chat
 *     round-trip row for every probed integration. A green tools row with
 *     the chat row MISSING is therefore an unverified family — it collapses
 *     a green/degraded fold to `status: null` (no-data), mirroring the
 *     D5/D6 missing-mapped-sub-row strictness. A present RED tools row
 *     still surfaces (red dominates no-data).
 *   - `tools:<slug>` is CONDITIONAL: the driver side-emits it only when the
 *     integration's demos include `tool-rendering`, so its absence is
 *     legitimate for tool-less integrations. The dashboard has no
 *     per-integration demo mapping to distinguish "not expected" from "not
 *     yet emitted", so a missing tools row stays LENIENT (chat alone can
 *     credit D4) — the safe default given the producer mapping lives
 *     harness-side.
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

  // STRICT on the UNCONDITIONAL row: a missing `chat:<slug>` (the row the
  // producer always writes) makes the family unverified — collapse a present
  // green/degraded fold to no-data, exactly like the D5/D6 anyMissing
  // collapse. RANK-based, not red-literal equality, so an out-of-vocabulary
  // state (ranked above red by the A2 machinery) still surfaces. The
  // conditional `tools:` row is deliberately NOT held to this (see the
  // expectation mapping in the doc above).
  if (!chatRow && rankOfState(worstState) < STATE_RANK.red) {
    return { exists: true, status: null, row: null };
  }

  return {
    exists: true,
    // foldStateToTestStatus (not the base stateToTestStatus): D4's `null` now
    // means NO-DATA to the chip's gate (the missing-chat collapse above), so
    // an out-of-vocabulary fold winner must map to "red" here instead of
    // relying on the gate's `!== "green"` catch-all — mirrors resolveD5/D6.
    status: foldStateToTestStatus(worstState),
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
    // Return the EFFECTIVE (downgraded) row so `.row.state` agrees with
    // `.status` — the same invariant resolveD4/D5/D6 maintain (mirrors
    // `buildBadge` in live-status.ts).
    return {
      exists: true,
      status: "amber",
      row: { ...row, state: "degraded" },
    };
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
 * Map a derived `ChipColor` onto the presentation surface state.
 * `FleetSurfaceState` is `ChipColor | "unreachable" | "pending"`, so every
 * chip colour passes straight through; the `"unreachable"` and `"pending"`
 * overlay members are applied separately by the caller when a comm error is
 * present (see the `surfaceState` derivation in `buildCellModel`). Pure; no
 * widening cast needed.
 */
function chipColorToSurface(color: ChipColor): FleetSurfaceState {
  return color;
}

/**
 * Decode a pool comm-error (REQ-B) for this cell by scanning the status rows
 * the cell's overlay depends on: the per-cell D6 (parity) row family, D5
 * (conversation), the D3/e2e row, the D4 (chat/tools) rows, health, the
 * integration-level d6 AGGREGATE row (`d6:<slug>`), AND the non-d6
 * fleet-family sweep aggregates (`d4:<slug>`, `e2e-demos:<slug>`,
 * `d5-single-pill-e2e:<slug>` — where the global lease sweep lands comm
 * errors for the smoke/demos/deep families). The control-plane mirrors a
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
 * equal (stable tie-break; an UNPARSEABLE `observedAt` never reaches the
 * tie-break — the staleness gate below skips it first). Returns `undefined`
 * when no candidate row carries a comm error (pool reachable).
 *
 * STALENESS WINDOW: a comm error is only surfaced while it is RECENT. The
 * control-plane mirrors a `PoolCommError` onto the `d6:<slug>` aggregate row but
 * NOTHING clears that blob on recovery — recovery just writes fresh green
 * per-cell rows. Without an age cap a single comm error would pin every cell of
 * the service to "unreachable" forever, even after the pool recovers. The
 * window is scoped PER ROW FAMILY, mirroring the window each family's own
 * resolver applies to stale-green rows: e2e-cadence rows (`d6`/`d5`/`e2e` and
 * the fleet-family aggregates) use `E2E_STALE_AFTER_MS`, the D4 real-time rows
 * (`chat`/`tools`) use `D4_STALE_AFTER_MS`, and the liveness row (`health`)
 * uses `LIVENESS_STALE_AFTER_MS` — a liveness-cadence row must not carry a
 * comm error for 6h when its own colour would have gone stale after 45m. A
 * comm error older than its row's window is treated as recovered and skipped,
 * exactly mirroring the resolveDx stale-green downgrade. `now` is threaded in
 * the same way buildCellModel passes it to the resolveDx resolvers.
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
/**
 * Maximum tolerated FUTURE skew on a comm error's `observedAt` (CF7-F3 #4).
 * The staleness gate in `decodeCellCommError` compares `now - parsed >
 * staleAfterMs`, which is NEVER true for a future-dated timestamp — so clock
 * skew (or a corrupt producer timestamp) would pin the unreachable/pending
 * overlay indefinitely, exactly the permanent-phantom failure mode the
 * unparseable-`observedAt` skip (FF7) exists to prevent. A timestamp more
 * than this far ahead of `now` is as untrustworthy as an unparseable one and
 * is treated the same way (stale → skipped); skew WITHIN the tolerance is
 * ordinary clock drift and still surfaces.
 */
const COMM_ERROR_FUTURE_SKEW_TOLERANCE_MS = 5 * 60 * 1000;

function decodeCellCommError(
  live: LiveStatusMap,
  slug: string,
  featureId: string,
  now: number,
): PoolCommError | undefined {
  // Per-cell D6/D5 rows fan out over the mapped featureType family. Each
  // candidate carries the staleness window of ITS row family (see the
  // STALENESS WINDOW doc above) so a liveness-cadence row's comm error ages
  // out on the liveness window, not the 6h e2e window.
  const familyKeys = CATALOG_TO_D5_KEY[featureId];
  const candidates: Array<{ key: string; staleAfterMs: number }> = [];
  if (familyKeys) {
    for (const ft of familyKeys) {
      candidates.push({
        key: keyFor("d6", slug, ft),
        staleAfterMs: E2E_STALE_AFTER_MS,
      });
      candidates.push({
        key: keyFor("d5", slug, ft),
        staleAfterMs: E2E_STALE_AFTER_MS,
      });
    }
  }
  // The d6 AGGREGATE row (`d6:<slug>`, no featureId) is where BOTH harness
  // legs mirror a per-service `PoolCommError` (REQ-B): the result-aggregator
  // overlays it onto the aggregate primary row (`result.aggregateKey` =
  // `d6:<slug>`), and the control-plane fleet-health leg writes it to the job's
  // `probe_key` (also `d6:<slug>`). Without scanning the aggregate key here the
  // dashboard never surfaces the "unreachable" overlay even though the signal
  // is persisted. Checked alongside the per-cell rows so a worker-death comm
  // error lights up every cell of the affected service. NOTE: the full set of
  // comm-error aggregate dimensions lives in FLEET_COMM_AGGREGATE_DIMENSIONS
  // (live-status.ts) — the same list useLiveStatus's supplemental initial
  // fetch uses to re-fetch these rows WITH `signal` (CF7-F3 #1); `d6` is
  // pushed here (before the per-cell e2e/chat/tools/health candidates — scan
  // order is the documented equal-timestamp tie-break and is pinned by tests)
  // and the non-d6 trio below (G3f).
  candidates.push({
    key: keyFor("d6", slug),
    staleAfterMs: E2E_STALE_AFTER_MS,
  });
  candidates.push({
    key: keyFor("e2e", slug, featureId),
    staleAfterMs: E2E_STALE_AFTER_MS,
  });
  candidates.push({
    key: keyFor("chat", slug),
    staleAfterMs: D4_STALE_AFTER_MS,
  });
  candidates.push({
    key: keyFor("tools", slug),
    staleAfterMs: D4_STALE_AFTER_MS,
  });
  candidates.push({
    key: keyFor("health", slug),
    staleAfterMs: LIVENESS_STALE_AFTER_MS,
  });
  // NON-d6 FLEET-FAMILY AGGREGATES (G3f): the global lease sweep reclaims
  // jobs of ALL four fleet families and mirrors each comm error onto the
  // status row keyed by the reclaimed job's `probe_key` (harness
  // resolveSweepAggregateKey → aggregateCommError — the same path that lands
  // on `d6:<slug>` for the d6 family). For the non-d6 families those keys are
  // `d4:<slug>` (smoke), `e2e-demos:<slug>` (demos), and
  // `d5-single-pill-e2e:<slug>` (deep) — see the catalog-enumerator probeKey
  // prefixes. The dashboard reads those rows NOWHERE else, so without
  // scanning them here a reclaim/crash overlay on those families is
  // invisible. They ride the job-queue (e2e) cadence → e2e window. Derived
  // from FLEET_COMM_AGGREGATE_DIMENSIONS (minus `d6`, pushed earlier — see
  // the aggregate-row note above) so this scan and useLiveStatus's
  // supplemental signal fetch can never drift apart.
  for (const dim of FLEET_COMM_AGGREGATE_DIMENSIONS) {
    if (dim === "d6") continue; // pushed above, in its pinned scan position
    candidates.push({
      key: keyFor(dim, slug),
      staleAfterMs: E2E_STALE_AFTER_MS,
    });
  }

  // Decode every candidate and keep the WORST comm error, ranking by KIND
  // SEVERITY first and using recency only as a same-severity tie-break. A
  // directly-observed crash (`worker-crashed-mid-job`, `worker-unreachable`,
  // every non-reclaim kind) is a HARD failure the worker/control-plane saw
  // first-hand; `worker-reclaimed-pending` is only the sweep boundary's
  // inference (a lease lapsed, job re-queued) and cannot tell a real crash from
  // a routine teardown. So a NEWER reclaim must NOT out-rank an OLDER real
  // crash — severity is the primary winner key, recency only the tie-break
  // WITHIN a tier. Within the same tier a later candidate wins only when its
  // `observedAt` is strictly newer, so for equal timestamps the
  // first-in-scan-order error is retained (stable tie-break). An unparseable
  // `observedAt` never reaches the tie-break: the staleness gate skips it.
  let winner: PoolCommError | undefined;
  let winnerSeverity = Number.NEGATIVE_INFINITY;
  let winnerTs = Number.NEGATIVE_INFINITY;
  for (const { key, staleAfterMs } of candidates) {
    const row = live.get(key);
    if (!row) continue;
    const commError = commErrorFromStatusSignal(row.signal);
    if (!commError) continue;
    // `observedAt` is an ISO string; `Date.parse` yields NaN for a malformed
    // value.
    const parsed = Date.parse(commError.observedAt);
    // STALENESS GATE: a comm error older than its row family's staleness
    // window is treated as recovered and skipped — nothing clears the
    // mirrored blob on recovery, so without this the cell would render
    // "unreachable" forever. Mirrors the resolveDx stale-green downgrade. An
    // UNPARSEABLE `observedAt` (NaN) is treated as stale too: it can never be
    // cleared on recovery (its age is undefined), so surfacing it would
    // strand a permanent phantom overlay. A FUTURE-dated `observedAt` beyond
    // the skew tolerance gets the same treatment (CF7-F3 #4): `now - parsed`
    // is negative so the age check can never expire it — clock skew would pin
    // the overlay indefinitely, the same permanent-phantom failure mode.
    //
    // KNOWN FAIL-SAFE DIVERGENCE vs `isStale` (staleness.ts, CF7-F3 #3): the
    // shared row-level predicate treats an unparseable `observed_at` as NOT
    // stale ("staleness must be a positive signal"), because there a false
    // `stale` would DOWNGRADE a live green row. Here the polarity inverts: a
    // false NOT-stale would PIN an uncleared overlay forever, so an
    // unparseable timestamp must read as stale/skip. The two sites fail safe
    // in OPPOSITE directions by design of their respective blast radii;
    // `isStale` itself predates this branch and is deliberately left as-is.
    if (
      Number.isNaN(parsed) ||
      parsed - now > COMM_ERROR_FUTURE_SKEW_TOLERANCE_MS ||
      now - parsed > staleAfterMs
    ) {
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

/**
 * Decide whether a cell's RED is attributable ONLY to harness infra signals
 * (`driver-error`/`abort` in `signal.errorClass` or `signal.errorDesc`) and so
 * should fold to gray (U7, spec §7.1).
 *
 * Scans EVERY row the chip's red can derive from — the D3 (e2e) row, the D4
 * chat/tools rows, and the D5/D6 per-cell families (mapped through
 * `CATALOG_TO_D5_KEY`, the same keyspace the resolvers fan out over). A row
 * "contributes red" when its persisted `state` ranks at or above `red` (rank
 * fold, NOT literal "red" equality — an out-of-vocabulary runtime state such
 * as `"error"` ranks ABOVE red and must still count, mirroring `rankOfState`).
 *
 * Returns true ONLY when there is at least one contributing red row AND EVERY
 * contributing red row carries an infra class. If ANY contributing red row is
 * NOT infra-classed (a genuine ran-and-failed assertion), this returns false
 * and the cell STAYS red — the masks-real-red guard (spec R-C). The resolvers
 * fold each family to a single worst row, so a family could hide a genuine red
 * behind an infra winner (or vice-versa); scanning the raw rows here — not the
 * resolved winners — is what makes the guard conservative.
 *
 * Staleness is NOT applied here: a stale GREEN row never contributes red, and
 * a red row's infra-ness does not age out (the signal classifies WHY the probe
 * failed, independent of when). The chip already computed `red`, so the only
 * question is whether that red is infra-only.
 */
function redIsPurelyInfra(
  live: LiveStatusMap,
  slug: string,
  featureId: string,
): boolean {
  const familyKeys = CATALOG_TO_D5_KEY[featureId];
  const keys: string[] = [
    keyFor("e2e", slug, featureId),
    keyFor("chat", slug),
    keyFor("tools", slug),
  ];
  if (familyKeys) {
    for (const ft of familyKeys) {
      keys.push(keyFor("d5", slug, ft));
      keys.push(keyFor("d6", slug, ft));
    }
  }

  let sawContributingRed = false;
  for (const key of keys) {
    const row = live.get(key);
    if (!row) continue;
    // A row contributes red when its state ranks at/above red — rank-based so
    // an out-of-vocabulary "error" state (ranked above red by the A2
    // machinery) is still treated as a failing contributor, not swallowed.
    if (rankOfState(row.state) < STATE_RANK.red) continue;
    if (!signalHasInfraErrorClass(row.signal)) {
      // A genuine ran-and-failed red — never fold it away.
      return false;
    }
    sawContributingRed = true;
  }
  return sawContributingRed;
}

/**
 * Result of the U8 matrix-freshness scan.
 *   - `freshestAgeMs` — age in ms of the cell's FRESHEST contributing
 *     observation (`now - max(observed_at)`), or `null` when the cell has no
 *     contributing rows (no-data; nothing to age).
 *   - `isStale` — true when at least one row contributes AND every contributing
 *     row is older than its own family staleness window. A single fresh row
 *     (relative to ITS window) means the cell was recently swept → not stale.
 */
interface CellFreshness {
  freshestAgeMs: number | null;
  isStale: boolean;
}

/**
 * Compute the cell's MATRIX freshness (U8, spec §7.2/§6.4).
 *
 * Scans EVERY row the cell renders from — the D3 (e2e) row, the D4 chat/tools
 * rows, the D5/D6 per-cell families (mapped through `CATALOG_TO_D5_KEY`, the
 * same keyspace the resolvers fan out over), and the D1/D2 `health` row — and
 * asks two things per row: how old is it, and is it stale relative to ITS OWN
 * family window? Windows differ by cadence (e2e/d5/d6 = `E2E_STALE_AFTER_MS`
 * (6h), chat/tools = `D4_STALE_AFTER_MS` (1h), health = `LIVENESS_STALE_AFTER_MS`
 * (45m)) — mirroring `decodeCellCommError`'s per-family staleness so a
 * fast-cadence row (health) does not wrongly mark a cell stale when its slower
 * e2e row is legitimately a couple hours old, and vice-versa.
 *
 * A cell is STALE only when it has at least one contributing row AND every
 * contributing row is past its window — i.e. the cell has not been swept on
 * ANY cadence within that cadence's tolerance. One fresh row keeps the cell
 * fresh (it was recently observed). The freshest age is `now - max(observed_at)`
 * across all contributing rows, surfaced so operators see "last swept N ago".
 *
 * An unparseable `observed_at` is treated as NOT fresh for the freshest-age
 * pick (it cannot establish recency) but IS treated as stale for the all-stale
 * verdict — a row with no trustworthy timestamp cannot vouch that the cell was
 * recently swept. This fails safe toward "re-sweep pending" (gray) rather than
 * trusting a corrupt timestamp to paint a frozen colour as live.
 */
function computeCellFreshness(
  live: LiveStatusMap,
  slug: string,
  featureId: string,
  now: number,
): CellFreshness {
  const familyKeys = CATALOG_TO_D5_KEY[featureId];
  const candidates: Array<{ key: string; staleAfterMs: number }> = [
    { key: keyFor("e2e", slug, featureId), staleAfterMs: E2E_STALE_AFTER_MS },
    { key: keyFor("chat", slug), staleAfterMs: D4_STALE_AFTER_MS },
    { key: keyFor("tools", slug), staleAfterMs: D4_STALE_AFTER_MS },
    { key: keyFor("health", slug), staleAfterMs: LIVENESS_STALE_AFTER_MS },
  ];
  if (familyKeys) {
    for (const ft of familyKeys) {
      candidates.push({
        key: keyFor("d5", slug, ft),
        staleAfterMs: E2E_STALE_AFTER_MS,
      });
      candidates.push({
        key: keyFor("d6", slug, ft),
        staleAfterMs: E2E_STALE_AFTER_MS,
      });
    }
  }

  let freshestAgeMs: number | null = null;
  let sawContributingRow = false;
  let allStale = true;
  for (const { key, staleAfterMs } of candidates) {
    const row = live.get(key);
    if (!row) continue;
    sawContributingRow = true;
    // Reuse the shared `isStale` primitive with this row's family window. An
    // unparseable timestamp reads as NOT stale there (staleness is a positive
    // signal) — but for the all-stale verdict a row with no trustworthy
    // timestamp must not vouch for recency, so treat unparseable as stale.
    const observedMs = Date.parse(row.observed_at);
    const rowStale = Number.isNaN(observedMs)
      ? true
      : isStale(row, now, staleAfterMs);
    if (!rowStale) allStale = false;
    // Freshest age: smallest non-negative `now - observed_at`. Skip an
    // unparseable timestamp — it cannot establish recency.
    if (!Number.isNaN(observedMs)) {
      const ageMs = now - observedMs;
      if (freshestAgeMs === null || ageMs < freshestAgeMs) {
        freshestAgeMs = ageMs;
      }
    }
  }

  return {
    freshestAgeMs,
    isStale: sawContributingRow && allStale,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

// Module-level singletons returned BY REFERENCE to every caller — frozen so
// one consumer mutating its "own" cell model cannot corrupt every other
// unsupported/not-wired cell sharing the reference.
const NOT_WIRED_LEVEL: TestLevel = Object.freeze({
  exists: false,
  status: null,
  row: null,
});

const UNSUPPORTED: CellModel = Object.freeze({
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
  isStaleCell: false,
  observedAtAgeMs: null,
});

/**
 * Resolve a STARTER cell's `ChipColor` + matrix-freshness from the four
 * `starter:<columnSlug>/<level>` rows the `starter_smoke` driver emits (level ∈
 * {@link STARTER_LEVELS}). A starter is NOT probed on the agent feature ladder,
 * so this is its OWN derivation — disjoint from the D3/D4/D5/D6 resolvers.
 *
 * The fold mirrors the agent ladder's philosophy so the equivalence gate stays
 * apples-to-apples on whichever axis a cell lives on:
 *   - per-row stale-green → degraded BEFORE the worst-state fold (the starter
 *     uses `STARTER_STALE_AFTER_MS`), so a frozen-green level can't mask a
 *     fresh sibling;
 *   - STRICT on missing rows: a level with no row makes the family unverified
 *     and collapses a green/degraded fold to no-data (`gray`) — a present RED
 *     still dominates no-data (rank-based, so an out-of-vocab state ranked
 *     above red still surfaces);
 *   - `green` only when ALL four levels are present AND green-and-fresh;
 *   - `amber` for a stale-green / degraded fold (not-green, but not a red);
 *   - the U8 matrix-staleness fold (every contributing row past its window →
 *     gray) is applied by the caller via the returned `isStale`.
 */
function resolveStarterChip(
  live: LiveStatusMap,
  columnSlug: string,
  now: number,
): { chipColor: ChipColor; isStale: boolean; freshestAgeMs: number | null } {
  let worstState: State | null = null;
  let anyMissing = false;
  let sawRow = false;
  let allStale = true;
  let freshestAgeMs: number | null = null;

  for (const level of STARTER_LEVELS as readonly StarterLevel[]) {
    const row = live.get(keyFor("starter", columnSlug, level)) ?? null;
    if (!row) {
      anyMissing = true;
      continue;
    }
    sawRow = true;
    // U8 matrix-freshness bookkeeping (mirrors computeCellFreshness): an
    // unparseable timestamp reads as stale for the all-stale verdict but cannot
    // establish recency for the freshest-age pick.
    const observedMs = Date.parse(row.observed_at);
    const rowStale = Number.isNaN(observedMs)
      ? true
      : isStale(row, now, STARTER_STALE_AFTER_MS);
    if (!rowStale) allStale = false;
    if (!Number.isNaN(observedMs)) {
      const ageMs = now - observedMs;
      if (freshestAgeMs === null || ageMs < freshestAgeMs)
        freshestAgeMs = ageMs;
    }
    // Per-row stale-green → degraded downgrade BEFORE the worst-state fold.
    const eff: State =
      row.state === "green" && isStale(row, now, STARTER_STALE_AFTER_MS)
        ? "degraded"
        : row.state;
    if (worstState === null || rankOfState(eff) > rankOfState(worstState)) {
      worstState = eff;
    }
  }

  // No starter rows at all → no-data gray (the resting state before the first
  // smoke tick), matrix-fresh-neutral.
  if (!sawRow || worstState === null) {
    return { chipColor: "gray", isStale: false, freshestAgeMs };
  }

  const matrixStale = sawRow && allStale;

  // STRICT missing-level collapse: a missing level makes the family unverified.
  // A present red-or-worse still dominates no-data (rank-based); otherwise a
  // green/degraded fold collapses to gray.
  let chipColor: ChipColor;
  if (anyMissing && rankOfState(worstState) < STATE_RANK.red) {
    chipColor = "gray";
  } else {
    const status = foldStateToTestStatus(worstState);
    chipColor =
      status === "green" ? "green" : status === "red" ? "red" : "amber";
  }

  // U8 matrix-staleness fold: a wholly-stale starter cell is "re-sweep pending"
  // → gray, exactly as the agent ladder folds a stale cell (and as U9's
  // equivalence gate excludes a stale prod cell).
  if (matrixStale && chipColor !== "gray") {
    chipColor = "gray";
  }

  return { chipColor, isStale: matrixStale, freshestAgeMs };
}

/**
 * Build the cell model for a STARTER-axis cell ({@link CellModelInput.probeAxis}
 * `=== "starter"`). The starter axis has no D3/D4/D5/D6 ladder, so the depth
 * levels are all `null`/no-data and the `chipColor` comes from
 * `resolveStarterChip` over the `starter:<columnSlug>/<level>` rows. No
 * comm-error overlay is decoded (the starter_smoke driver does not ride the
 * fleet comm-error path), so `surfaceState` mirrors `chipColor`.
 */
function buildStarterCellModel(
  live: LiveStatusMap,
  columnSlug: string,
  now: number,
): CellModel {
  const { chipColor, isStale, freshestAgeMs } = resolveStarterChip(
    live,
    columnSlug,
    now,
  );
  return {
    supported: true,
    d3: NOT_WIRED_LEVEL,
    d4: NOT_WIRED_LEVEL,
    d5: NOT_WIRED_LEVEL,
    d6: NOT_WIRED_LEVEL,
    d6Effective: null,
    achievedDepth: 0,
    ceilingDepth: 0,
    chipColor,
    isRegression: false,
    surfaceState: chipColorToSurface(chipColor),
    isStaleCell: isStale,
    observedAtAgeMs: freshestAgeMs,
  };
}

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

  // ── Starter axis: resolve off the starter_smoke matrix, NOT the agent
  //    feature ladder. A starter's `slug` is its dashboard COLUMN slug. ──
  if (input.probeAxis === "starter") {
    if (!isWired) return UNSUPPORTED;
    return buildStarterCellModel(live, slug, now);
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
      isStaleCell: false,
      observedAtAgeMs: null,
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
  // Decision table over (d1d4GateFails, d4 no-data, D3/D4 absent, d5.exists,
  // d5.status, d6.status):
  //   gate fails                                  → red  (gate dominates)
  //   D4 null (unverified family) + D5/D6 red     → red  (red dominates
  //                                                 no-data)
  //   D4 null (unverified family) otherwise       → gray (no-data — the
  //                                                 missing-chat collapse,
  //                                                 mirroring D5/D6's
  //                                                 anyMissing gray)
  //   D3+D4 BOTH absent + D5/D6 red               → red  (red dominates
  //                                                 no-data)
  //   D3+D4 BOTH absent otherwise                 → gray (unverified — green
  //                                                 is the strict reward for
  //                                                 an INTACT ladder, and an
  //                                                 ABSENT lower ladder can
  //                                                 never be weaker evidence
  //                                                 than a present-but-null
  //                                                 one; see CF7-F3 #2)
  //   D5 unmapped (!d5.exists)                    → gray (ceiling is D4; D6
  //                                                 shares CATALOG_TO_D5_KEY,
  //                                                 so it is unmapped too)
  //   D5 green + D6 green                         → green
  //   D5 green + D6 red/amber/missing             → amber
  //   D5 red/amber + (any D6)                     → red  (broken ladder)
  //   D5 null  + D6 red                           → red
  //   D5 null  + D6 green/amber/missing           → gray (unverified ladder)
  //
  // The D4 leg of the gate excludes `null`: a present-but-null D4 is the
  // missing-chat NO-DATA collapse (resolveD4), which is unverified, not
  // failed. An out-of-vocabulary D4 fold winner cannot hide behind that
  // exclusion — resolveD4 maps it to "red" via foldStateToTestStatus. D3 has
  // no no-data collapse, so its leg keeps the `!== "green"` catch-all (which
  // also rescues an out-of-vocabulary D3 state mapped to null).
  const d1d4GateFails =
    (d3.exists && d3.status !== "green") ||
    (d4.exists && d4.status !== "green" && d4.status !== null);
  // Present-but-null D4: the unconditional chat row is missing, so the
  // real-time family is UNVERIFIED — the documented no-data outcome.
  const d4NoData = d4.exists && d4.status === null;
  // ABSENT D1-D4 family (CF7-F3 #2): neither the D3 (e2e) row nor ANY D4
  // (chat/tools) row exists, so the ladder below D5 is wholly unverified. The
  // gate above can't catch this — it fires only on `exists` — so without this
  // predicate a cell with ONLY green D5/D6 rows rendered a green chip (and a
  // green d6Effective) at achievedDepth=0, a false top-of-ladder claim. Same
  // strictness family as `d4NoData`: absence is no-data, never credit.
  const d1d4Absent = !d3.exists && !d4.exists;

  let chipColor: ChipColor;
  if (d1d4GateFails) {
    // A failing/stale D1-D4 gate dominates everything below it.
    chipColor = "red";
  } else if (d4NoData || d1d4Absent) {
    // Unverified D4 family (missing-chat collapse) OR a wholly ABSENT D3/D4
    // family → no-data gray, exactly like the D5/D6 anyMissing collapse. A
    // present red ABOVE it (D5/D6) still surfaces — red dominates no-data,
    // mirroring the `D5 null + D6 red → red` row below.
    chipColor = d5.status === "red" || d6.status === "red" ? "red" : "gray";
  } else if (!d5.exists) {
    // D5 is not mapped for this feature → ceiling is D4. resolveD5 and
    // resolveD6 derive `exists` from the SAME `CATALOG_TO_D5_KEY` entry, so
    // `!d5.exists` IMPLIES `!d6.exists` — there is no "unmapped D5 but
    // present D6" combination to consider. Green requires a contiguous D5,
    // so the cell sits at its D4 ceiling with no further verification: gray.
    // (Should the two dimensions ever split onto separate maps, a present
    // failing D6 here would need to surface — re-introduce a D6 check then.)
    chipColor = "gray";
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

  // ── U7: harness driver-error/abort INFRA fold (§7.1) ──────────────
  // A cell that is RED purely because its failing rows carry a harness infra
  // signal (`driver-error`/`abort` in `signal.errorClass` or `signal.errorDesc`)
  // is folded to the existing `gray` ChipColor (no-data) — an infra blip is not
  // a genuine product red and must not show as one on the matrix. The fold is
  // CONSERVATIVE: it fires only when EVERY contributing red row is infra-classed
  // (see `redIsPurelyInfra`), so a real ran-and-failed assertion — alone or
  // alongside an infra red on a sibling rung — keeps the cell RED. Applied only
  // to a red chip; green/amber/gray are untouched, and the masks-real-red guard
  // (spec R-C) lives entirely in `redIsPurelyInfra`.
  if (chipColor === "red" && redIsPurelyInfra(live, slug, featureId)) {
    chipColor = "gray";
  }

  // ── U8: matrix staleness fold (§7.2 / §6.4) ───────────────────────
  // The per-depth resolvers only downgrade a stale GREEN to amber and let a
  // stale RED pass through frozen — correct for the depth LADDER. But on the
  // MATRIX a cell whose freshest observation predates its re-sweep window is
  // "re-sweep pending": its frozen colour (red INCLUDED) is no longer a live
  // claim, so fold ANY non-gray chip to gray. The cell is stale only when
  // EVERY contributing row is past its own family window (one fresh row keeps
  // it live — see `computeCellFreshness`), so a fresh red stays red and the
  // existing "fresh e2e + stale D5" depth cases are untouched. This is the SAME
  // treatment U9's equivalence gate applies (a stale prod row is excluded).
  // Runs AFTER U7's infra fold: a stale driver-error cell is already gray, so
  // the two folds compose without either masking the other.
  const freshness = computeCellFreshness(live, slug, featureId, now);
  const isStaleCell = freshness.isStale;
  if (isStaleCell && chipColor !== "gray") {
    chipColor = "gray";
  }

  // d6Effective — ladder-gated D6 status for the D6 badge + D6 stat.
  //
  // D6 is the TOP of the verification ladder, so a green D6 claim is only
  // meaningful when the ladder through D5 is intact. This reuses the SAME
  // ladder predicates the chip uses above (`d1d4GateFails`, `d5.status`) so the
  // badge/stat never contradict the chip:
  //   gate fails              → null (blocked; API/BE badge shows the failure)
  //   D4 no-data (status null)→ null (ladder UNVERIFIED at D4 — the
  //                             missing-chat collapse; same blocked outcome
  //                             as a failing gate, but the chip shows gray)
  //   D3+D4 BOTH absent       → null (ladder UNVERIFIED below D5 by ABSENCE —
  //                             the CF7-F3 #2 collapse; same blocked outcome
  //                             as the D4 no-data collapse)
  //   D5 not mapped (!exists) → raw d6.status (no D5 rung to gate against;
  //                             D6 shares CATALOG_TO_D5_KEY so it is unmapped
  //                             too and the raw status is null today — the
  //                             passthrough matters only if the maps split)
  //   D5 green                → raw d6.status (ladder intact through D5; a
  //                             genuine D6 red/amber/green passes through)
  //   D5 red/amber/null       → null (ladder BROKEN/unverified below D6 → the
  //                             D6 claim is not-achieved/blocked; never a false
  //                             green and never a false red — the 1P badge
  //                             already shows the real lower-rung failure)
  let d6Effective: TestStatus;
  if (d1d4GateFails || d4NoData || d1d4Absent) {
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
        // failure that the neutral pending overlay must NOT mask — otherwise
        // DepthChip's "pending" early-return would hide a real failure. The
        // failure colour wins; routine teardown (green/gray) still shows gray.
        //
        // DELIBERATE ASYMMETRY vs the harness `fleetSurfaceState` gate: the
        // harness derives over `ProbeState`, which has NO no-data colour, so
        // its gate is green-only ("green becomes pending, everything else
        // passes through"). The dashboard derives over `ChipColor`, whose
        // `gray` is the dashboard-only no-data colour the harness cannot
        // represent — and a no-data cell awaiting a re-queued job IS pending,
        // so gray ALSO becomes "pending" here. Both sides agree on the
        // never-mask rule: red / amber (degraded) / error-derived states /
        // regression always pass through; ONLY the healthy-or-no-data cases
        // become "pending". Pinned by the surface-state drift suite in
        // commError-contract-drift.test.ts.
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
    isStaleCell,
    observedAtAgeMs: freshness.freshestAgeMs,
  };
}
