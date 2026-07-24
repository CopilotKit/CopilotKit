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
  isFutureSkewed,
} from "./staleness.js";
import {
  classifyRung,
  staleWindowFor,
  foldFamily,
  contributionToColor,
  rankOfState as rankOfStateShared,
  foldStateToTestStatus as foldStateToTestStatusShared,
  stateToTestStatus as stateToTestStatusShared,
  RED_RANK,
  type RawRung,
  type RungKind,
  type RungContribution,
} from "./cell-model.contribution.js";
import { combine, type LadderDepth } from "./cell-model.combine.js";

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
   * the classified D6 CONTRIBUTION surfaces (a genuine D6 FAIL_FRESH still
   * surfaces as red; an infra/no-data D6 collapses to null — see below).
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
   * through D5 (`d5.status === "green"`, gate passing), `d6Effective` reflects
   * the D6 CONTRIBUTION colour — NOT the raw `d6.status` — via
   * `contributionToD6Status` (see `cell-model.combine.ts`): a genuine
   * `FAIL_FRESH` surfaces red, a stale/first-strike D6 surfaces amber, and an
   * INFRA_RED/NO_DATA/ABSENT D6 collapses to `null` (so an infra/soft red does
   * NOT masquerade as a product-red badge — this is the INV5 coherence fix).
   * The chip collapses every non-green D6 to amber on top of that:
   *   D5 green + D6 green            → chip green, d6Effective green
   *   D5 green + D6 FAIL_FRESH       → chip amber, d6Effective RED
   *   D5 green + D6 stale/1st-strike → chip amber, d6Effective amber
   *   D5 green + D6 infra/no-data    → chip amber, d6Effective null
   *   gate fails / D5 broken/null    → chip red or gray, d6Effective null (blocked)
   * The chip is the coarser of the two: amber covers ANY non-green D6 once the
   * ladder is intact, whereas d6Effective preserves the classified D6 colour
   * (a genuine D6 FAIL_FRESH surfaces as red on the badge/stat).
   */
  d6Effective: TestStatus;
  achievedDepth: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  ceilingDepth: 0 | 1 | 2 | 3 | 4 | 5 | 6;
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
   * (`now - max(observed_at)` across the rows the chip derives from), clamped
   * to `>= 0` so a within-tolerance future-dated row never surfaces a negative
   * "in the future" age. Surfaces staleness to operators ("last swept N ago").
   * `null` when there is no ageable observation — either the cell has no
   * contributing rows (no-data), OR every contributing row's `observed_at` is
   * unparseable/future-skewed (present but untimeable; `isStaleCell` is then
   * still `true`). So `null` does NOT imply "no contributing rows".
   */
  observedAtAgeMs: number | null;
}

export interface CellModelInput {
  slug: string;
  /**
   * The catalog feature ID, or `null` for a LIVENESS-ONLY cell (no D3–D6
   * feature ladder). A null-feature cell reaches at most D2 (integration
   * liveness): `buildCellModel` attaches no D3+ rungs, its structural ceiling
   * is 2, and its achieved depth is 0/1/2 by the D1/D2 gate alone (§F, §5a).
   * `null` is the discriminator the engine branches on — NOT a sentinel string
   * (a sentinel would risk colliding with a real PB key).
   */
  featureId: string | null;
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
 * same keyspace the resolvers fan out over), and BOTH liveness rows (D1
 * `health` and D2 `agent`) — and asks two things per row: how old is it, and
 * is it stale relative to ITS OWN
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
  // §E: when true, a FUTURE-skewed row (observed_at beyond the skew tolerance)
  // is treated as STALE and excluded from the freshest-age pick — never read as
  // "swept 0ms ago". Defaults false so the legacy `buildCellModel` (and the
  // frozen golden master) are byte-unchanged; the V2 pipeline passes true.
  clampFutureSkew = false,
): CellFreshness {
  const familyKeys = CATALOG_TO_D5_KEY[featureId];
  const candidates: Array<{ key: string; staleAfterMs: number }> = [
    { key: keyFor("e2e", slug, featureId), staleAfterMs: E2E_STALE_AFTER_MS },
    { key: keyFor("chat", slug), staleAfterMs: D4_STALE_AFTER_MS },
    { key: keyFor("tools", slug), staleAfterMs: D4_STALE_AFTER_MS },
    // D1 (health) and D2 (agent) both contribute to the chip (a present
    // fresh-red D1/D2 gates it — §F), so both keep the cell fresh. `agent` was
    // previously omitted, so a cell fresh ONLY on its D2 row read as stale
    // (masking a fresh liveness state and mis-aging `observedAtAgeMs`); this
    // mirrors the null-feature path, which folds `agent` rows into freshness.
    { key: keyFor("health", slug), staleAfterMs: LIVENESS_STALE_AFTER_MS },
    { key: keyFor("agent", slug), staleAfterMs: LIVENESS_STALE_AFTER_MS },
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
    const skewed = clampFutureSkew && isFutureSkewed(row, now);
    const rowStale = Number.isNaN(observedMs)
      ? true
      : skewed || isStale(row, now, staleAfterMs);
    if (!rowStale) allStale = false;
    // Freshest age: smallest non-negative `now - observed_at`. Skip an
    // unparseable timestamp — it cannot establish recency — and (§E) a
    // future-skewed row, which cannot vouch that the cell was swept "now".
    if (!Number.isNaN(observedMs) && !skewed) {
      // §E: clamp a within-tolerance future-dated row to 0 so the surfaced
      // "last swept N ago" age can never be negative (sub-5m clock drift).
      const ageMs = Math.max(0, now - observedMs);
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

// A SUPPORTED but not-yet-wired cell: no data to render, gray no-data chip.
// Distinct from UNSUPPORTED (`supported:false`, 🚫) — this cell IS in scope,
// it just has not been built/wired yet. Shared by the agent AND starter axes so
// a supported-but-unwired starter (`status:"unshipped"`) renders identically to
// the equivalent agent cell instead of the contradictory `supported:false`.
const NOT_WIRED_CELL: CellModel = Object.freeze({
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
});

// ===========================================================================
// V2 pipeline (collect → classifyRung → combine) — built ALONGSIDE the legacy
// engine; swapped in at T9a. See spec §2–§4 + §F.
// ===========================================================================

/** Structural reachability ceiling (`computeMaxPossible` semantics — §4b). */
function structuralCeiling(input: CellModelInput): LadderDepth {
  if (!input.isSupported || !input.isWired) return 0;
  if (input.featureId === null) return 2;
  const d5 = CATALOG_TO_D5_KEY[input.featureId];
  return d5 && d5.length > 0 ? 6 : 4;
}

/** Gather the present rows of a rung's expected keys (Stage A lookup). */
function gatherRows(
  live: LiveStatusMap,
  keys: string[],
): { rows: StatusRow[]; anyMissing: boolean; signalKnown: boolean } {
  const rows: StatusRow[] = [];
  let anyMissing = false;
  let signalKnown = true;
  for (const k of keys) {
    const r = live.get(k);
    if (!r) {
      anyMissing = true;
      continue;
    }
    rows.push(r);
    if (r.signal === undefined) signalKnown = false;
  }
  return { rows, anyMissing, signalKnown };
}

/**
 * Build a TestLevel from a family fold, reproducing the legacy resolver
 * `{ exists, status }` exactly so the `d3/d4/d5/d6` output fields (consumed by
 * the badges) are behavior-preserving. `existsWhenEmpty` distinguishes a
 * mapped-but-unemitted D5/D6 (`exists: true`, no-data) from an absent
 * D3/D4 row (`exists: false`). Future-skew is clamped (§E) via `foldFamily`.
 */
function testLevelFromFold(
  kind: RungKind,
  rows: StatusRow[],
  anyExpectedMissing: boolean,
  existsWhenEmpty: boolean,
  now: number,
): TestLevel {
  if (rows.length === 0) {
    return { exists: existsWhenEmpty, status: null, row: null };
  }
  const fold = foldFamily(rows, staleWindowFor(kind), now);
  const worst = fold.worstState;
  if (worst === null) {
    return { exists: true, status: null, row: null };
  }
  // STRICT anyMissing collapse: a missing unconditional/mapped sub-row makes a
  // present green/degraded fold unverified → no-data (a present red dominates).
  if (anyExpectedMissing && rankOfStateShared(worst) < RED_RANK) {
    return { exists: true, status: null, row: null };
  }
  const status =
    kind === "D3"
      ? (stateToTestStatusShared(worst) ?? "red")
      : foldStateToTestStatusShared(worst);
  // Surface the WINNER row (the row that produced `worst`) — matching
  // origin/main's resolvers — so `TestLevel.row` is the effective row for a
  // multi-row family (e.g. a red tools row wins over a green chat row) and
  // `d0-gone-monitor` times an outage onset off the same row the fold verdict
  // came from. Falls back to the first present row if the fold reported none.
  return { exists: true, status, row: fold.worstRow ?? rows[0] ?? null };
}

interface CollectedLadder {
  rungs: RawRung[];
  d3: TestLevel;
  d4: TestLevel;
  d5: TestLevel;
  d6: TestLevel;
}

/** Stage A collect for an agent-axis (feature) cell. */
function collectAgentLadder(
  live: LiveStatusMap,
  slug: string,
  featureId: string,
  now: number,
): CollectedLadder {
  const d5Keys = CATALOG_TO_D5_KEY[featureId];
  const hasD5 = !!(d5Keys && d5Keys.length > 0);

  // D1 / D2 (liveness) — single-key each.
  const health = gatherRows(live, [keyFor("health", slug)]);
  const agent = gatherRows(live, [keyFor("agent", slug)]);
  // D3 (e2e) — single key.
  const e2e = gatherRows(live, [keyFor("e2e", slug, featureId)]);
  // D4 (chat unconditional + tools conditional).
  const chat = live.get(keyFor("chat", slug)) ?? null;
  const tools = live.get(keyFor("tools", slug)) ?? null;
  const d4Rows = [chat, tools].filter((r): r is StatusRow => !!r);
  const d4ChatMissing = !chat;
  const d4SignalKnown = d4Rows.every((r) => r.signal !== undefined);
  // D5 / D6 — multi-key families.
  const d5Full = hasD5
    ? gatherRows(
        live,
        (d5Keys as readonly string[]).map((ft) => keyFor("d5", slug, ft)),
      )
    : { rows: [] as StatusRow[], anyMissing: false, signalKnown: true };
  const d6Full = hasD5
    ? gatherRows(
        live,
        (d5Keys as readonly string[]).map((ft) => keyFor("d6", slug, ft)),
      )
    : { rows: [] as StatusRow[], anyMissing: false, signalKnown: true };

  const rungs: RawRung[] = [
    {
      kind: "D1",
      rows: health.rows,
      mapped: true,
      anyExpectedMissing: false,
      signalKnown: health.signalKnown,
    },
    {
      kind: "D2",
      rows: agent.rows,
      mapped: true,
      anyExpectedMissing: false,
      signalKnown: agent.signalKnown,
    },
    {
      kind: "D3",
      rows: e2e.rows,
      mapped: true,
      anyExpectedMissing: false,
      signalKnown: e2e.signalKnown,
    },
    {
      kind: "D4",
      rows: d4Rows,
      mapped: true,
      anyExpectedMissing: d4ChatMissing,
      signalKnown: d4SignalKnown,
    },
  ];
  if (hasD5) {
    rungs.push({
      kind: "D5",
      rows: d5Full.rows,
      mapped: true,
      anyExpectedMissing: d5Full.anyMissing,
      signalKnown: d5Full.signalKnown,
    });
    rungs.push({
      kind: "D6",
      rows: d6Full.rows,
      mapped: true,
      anyExpectedMissing: d6Full.anyMissing,
      signalKnown: d6Full.signalKnown,
    });
  }

  return {
    rungs,
    d3: testLevelFromFold("D3", e2e.rows, false, false, now),
    d4: testLevelFromFold("D4", d4Rows, d4ChatMissing, false, now),
    d5: testLevelFromFold("D5", d5Full.rows, d5Full.anyMissing, hasD5, now),
    d6: testLevelFromFold("D6", d6Full.rows, d6Full.anyMissing, hasD5, now),
  };
}

/**
 * Build the V2 cell model for a STARTER-axis cell — routed through the SAME
 * classifier over the four `starter:<column>/<level>` rows, then the U8
 * all-stale fold (§4g, §C). No D1–D6 ladder.
 */
function buildStarterCellModelV2(
  live: LiveStatusMap,
  columnSlug: string,
  now: number,
): CellModel {
  const keys = (STARTER_LEVELS as readonly StarterLevel[]).map((level) =>
    keyFor("starter", columnSlug, level),
  );
  const { rows, anyMissing, signalKnown } = gatherRows(live, keys);
  const contribution = classifyRung(
    {
      kind: "starter",
      rows,
      mapped: true,
      anyExpectedMissing: anyMissing,
      signalKnown,
    },
    now,
  );
  let chipColor = contributionToColor(contribution.contribution);

  // U8 all-stale fold over the STARTER rows (mirrors resolveStarterChip; the
  // shared computeCellFreshness scans the agent keyspace, not starter keys).
  let sawRow = false;
  let allStale = true;
  let freshestAgeMs: number | null = null;
  for (const row of rows) {
    sawRow = true;
    const observedMs = Date.parse(row.observed_at);
    const skewed = isFutureSkewed(row, now);
    const rowStale = Number.isNaN(observedMs)
      ? true
      : skewed || isStale(row, now, STARTER_STALE_AFTER_MS);
    if (!rowStale) allStale = false;
    if (!Number.isNaN(observedMs) && !skewed) {
      // §E: clamp a within-tolerance future-dated row to 0 so the surfaced
      // "last swept N ago" age can never be negative (sub-5m clock drift).
      const ageMs = Math.max(0, now - observedMs);
      if (freshestAgeMs === null || ageMs < freshestAgeMs)
        freshestAgeMs = ageMs;
    }
  }
  const isStaleCell = sawRow && allStale;
  if (isStaleCell && chipColor !== "gray") chipColor = "gray";

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
    isStaleCell,
    observedAtAgeMs: freshestAgeMs,
  };
}

/**
 * Build the complete cell model for a single cell — the ONE pure total
 * derivation (spec §2). Runs the three-stage pipeline `collect → classifyRung →
 * combine`; chip color, achieved/ceiling depth, `d6Effective`, `isRegression`,
 * staleness and the comm-error overlay are all read off ONE classified
 * `RungContribution[]`. Signature and output field NAMES are unchanged from the
 * legacy engine; `achievedDepth`/`ceilingDepth` widened to `0..6` (§B).
 */
export function buildCellModel(
  live: LiveStatusMap,
  input: CellModelInput,
  now: number = Date.now(),
): CellModel {
  const { slug, isSupported, isWired } = input;
  // Normalize an empty-string featureId to `null` (the liveness-only
  // discriminator). `keyFor` throws hard on an empty per-feature segment, so an
  // empty featureId reaching the agent path would crash the WHOLE matrix
  // render, not just this cell. Treating it as a null-feature cell degrades one
  // cell instead. (Callers should pass `null`; this is a defensive guard.)
  const featureId = input.featureId === "" ? null : input.featureId;

  if (!isSupported) return UNSUPPORTED;

  if (input.probeAxis === "starter") {
    // A supported-but-unwired starter is gray no-data (like the agent path),
    // NOT UNSUPPORTED — `supported:false` would contradict `isSupported:true`.
    if (!isWired) return NOT_WIRED_CELL;
    return buildStarterCellModelV2(live, slug, now);
  }

  if (!isWired) return NOT_WIRED_CELL;

  const ceiling = structuralCeiling({ ...input, featureId });

  // ── Null-feature (liveness-only) cell: D1/D2 only, ceiling 2 (§F/§5a) ──
  if (featureId === null) {
    const health = gatherRows(live, [keyFor("health", slug)]);
    const agent = gatherRows(live, [keyFor("agent", slug)]);
    const contribs: RungContribution[] = [
      classifyRung(
        {
          kind: "D1",
          rows: health.rows,
          mapped: true,
          anyExpectedMissing: false,
          signalKnown: health.signalKnown,
        },
        now,
      ),
      classifyRung(
        {
          kind: "D2",
          rows: agent.rows,
          mapped: true,
          anyExpectedMissing: false,
          signalKnown: agent.signalKnown,
        },
        now,
      ),
    ];
    const c = combine(contribs, 2, now);
    // Null-feature cells have no per-cell feature family; U8 folds over the
    // liveness rows (health + agent) alone, each on the D1/D2 window (§E clamp).
    let sawRow = false;
    let allStale = true;
    let freshestAgeMs: number | null = null;
    for (const row of [...health.rows, ...agent.rows]) {
      sawRow = true;
      const observedMs = Date.parse(row.observed_at);
      const skewed = isFutureSkewed(row, now);
      const rowStale = Number.isNaN(observedMs)
        ? true
        : skewed || isStale(row, now, LIVENESS_STALE_AFTER_MS);
      if (!rowStale) allStale = false;
      if (!Number.isNaN(observedMs) && !skewed) {
        // §E: clamp a within-tolerance future-dated row to 0 so the surfaced
        // "last swept N ago" age can never be negative (sub-5m clock drift).
        const ageMs = Math.max(0, now - observedMs);
        if (freshestAgeMs === null || ageMs < freshestAgeMs)
          freshestAgeMs = ageMs;
      }
    }
    const isStaleCell = sawRow && allStale;
    let chipColor = c.chipColor;
    if (isStaleCell && chipColor !== "gray") chipColor = "gray";
    return {
      supported: true,
      d3: NOT_WIRED_LEVEL,
      d4: NOT_WIRED_LEVEL,
      d5: NOT_WIRED_LEVEL,
      d6: NOT_WIRED_LEVEL,
      d6Effective: null,
      achievedDepth: c.achievedDepth,
      ceilingDepth: c.ceilingDepth,
      chipColor,
      isRegression: c.isRegression,
      surfaceState: chipColorToSurface(chipColor),
      isStaleCell,
      observedAtAgeMs: freshestAgeMs,
    };
  }

  // ── Agent-axis feature cell ────────────────────────────────────────
  const collected = collectAgentLadder(live, slug, featureId, now);
  const contribs = collected.rungs.map((r) => classifyRung(r, now));
  const c = combine(contribs, ceiling, now);

  let chipColor = c.chipColor;

  // U8: matrix all-stale fold (§4e) — future-skew clamped (§E).
  const freshness = computeCellFreshness(live, slug, featureId, now, true);
  const isStaleCell = freshness.isStale;
  if (isStaleCell && chipColor !== "gray") chipColor = "gray";

  // Comm-error overlay (unchanged placement, §4e).
  const commError = decodeCellCommError(live, slug, featureId, now);
  const surfaceState: FleetSurfaceState = commError
    ? commError.kind === "worker-reclaimed-pending"
      ? chipColor === "red" || chipColor === "amber" || c.isRegression
        ? chipColorToSurface(chipColor)
        : "pending"
      : "unreachable"
    : chipColorToSurface(chipColor);

  return {
    supported: true,
    d3: collected.d3,
    d4: collected.d4,
    d5: collected.d5,
    d6: collected.d6,
    d6Effective: c.d6Effective,
    achievedDepth: c.achievedDepth,
    ceilingDepth: c.ceilingDepth,
    chipColor,
    isRegression: c.isRegression,
    ...(commError ? { commError } : {}),
    surfaceState,
    isStaleCell,
    observedAtAgeMs: freshness.freshestAgeMs,
  };
}
