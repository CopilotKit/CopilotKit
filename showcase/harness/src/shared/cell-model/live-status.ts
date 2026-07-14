/**
 * Shared types + key helpers for the live-status path (§5.4, §5 of the
 * showcase-harness design spec).
 *
 * PB row keys: `<dimension>:<slug>` for integration-level dimensions
 * (e.g. `health`, `agent`, `chat`, `tools`), or
 * `<dimension>:<slug>/<featureType>` for per-feature dimensions
 * (e.g. `smoke`, `e2e`, `d5`, `d6`). The `d5:` per-feature rows are
 * emitted by the `e2e-deep` driver, and `d6:` per-feature rows by the
 * `e2e-parity` driver (D5/D6 spec) — both fan out over the same
 * `D5FeatureType` keyspace (e.g. `agentic-chat`) so the per-cell lookup
 * pattern stays uniform. The e2e-parity driver ALSO writes an
 * integration-level `d6:<slug>` aggregate, but the dashboard resolves D6
 * per-cell (the aggregate is red whenever any cell fails).
 */

import { formatTs } from "./format-ts.js";
import {
  D4_STALE_AFTER_MS,
  E2E_STALE_AFTER_MS,
  LIVENESS_STALE_AFTER_MS,
  STARTER_STALE_AFTER_MS,
  isStale,
} from "./staleness.js";

export type State = "green" | "red" | "degraded";

/* ------------------------------------------------------------------ */
/*  Pool comm-error surface (REQ-B)                                     */
/* ------------------------------------------------------------------ */

/**
 * Pool COMMUNICATION-failure taxonomy + signal decode — the DASHBOARD-side
 * mirror of the harness fleet contract (`showcase/harness/src/fleet/contracts.ts`).
 *
 * WHY MIRRORED, NOT IMPORTED: the dashboard imports only `@/*` and never
 * reaches across the package boundary into harness source at runtime (same
 * rule that makes `CATALOG_TO_D5_KEY` / `STARTER_COLUMNS` local copies of
 * harness producer constants). The harness owns the producer side; the
 * dashboard carries a structural copy of the read shape it consumes. The
 * `commError-contract-drift.test.ts` lint test guards the two against drift.
 *
 * The comm error rides in the status-row SIGNAL under the well-known
 * `FLEET_COMM_ERROR_SIGNAL_KEY` ("__fleetCommError") — the persisted `State`
 * enum is deliberately NOT widened (that would force every state-machine
 * consumer — alert engine, transition detector, flap counter — to learn a new
 * value). The row's `state` keeps carrying the last-known probe colour; the
 * comm error is a SEPARATE overlay the dashboard renders as the DISTINCT
 * `"unreachable"` surface state so an operator can tell "couldn't reach the
 * pool" apart from "the test went red".
 */
export const POOL_COMM_ERROR_KINDS = [
  /** Worker host/endpoint did not respond at all (connect refused, DNS, etc). */
  "worker-unreachable",
  /** A claim or lease CAS call failed at the transport layer (not a lost CAS). */
  "claim-comm-failure",
  /** The worker exceeded the protocol response deadline (hung, no crash). */
  "worker-protocol-timeout",
  /**
   * A known crash/loss on a specific job (stays red), reported by either of
   * two sources: the worker's OWN self-monitor (observed an in-driver
   * pool-infra crash mid-job), or the control-plane RESULT CONSUMER (a row
   * went terminal but its separate result write never landed past the grace
   * window — the result is lost). A lease that merely expired with no
   * terminal report is NEITHER source; the sweep emits
   * `worker-reclaimed-pending` for that. Mirror of the harness kind doc.
   */
  "worker-crashed-mid-job",
  /** A report arrived but failed schema/shape validation (protocol mismatch). */
  "worker-protocol-violation",
  /**
   * A lease lapsed and the control-plane sweeper RE-QUEUED the job to pending.
   * The sweep boundary cannot tell a real crash from an expected platform
   * teardown, but either way the job is back in flight — so the dashboard
   * renders this as a NEUTRAL "re-queued / pending" surface (gray), NOT the red
   * "unreachable" overlay. Mirror of the harness `worker-reclaimed-pending`
   * kind; the cross-package drift test pins the two lists equal.
   */
  "worker-reclaimed-pending",
] as const;

/** A single pool communication-failure kind. */
export type PoolCommErrorKind = (typeof POOL_COMM_ERROR_KINDS)[number];

/** Type guard for a valid PoolCommErrorKind. */
export function isPoolCommErrorKind(
  value: string | undefined,
): value is PoolCommErrorKind {
  return (
    value !== undefined &&
    (POOL_COMM_ERROR_KINDS as readonly string[]).includes(value)
  );
}

/**
 * A structured pool communication error — the read shape the dashboard
 * surfaces. Mirror of the harness `PoolCommError` interface.
 */
export interface PoolCommError {
  kind: PoolCommErrorKind;
  /** Human-readable detail for the dashboard tooltip / operator log. */
  message: string;
  /** The worker involved, when known (unreachable workers may be unknown). */
  workerId?: string;
  /** The job involved, when the failure is tied to a specific job. */
  jobId?: string;
  /** ISO timestamp the failure was observed. */
  observedAt: string;
}

/** Signal-blob key under which a comm error is mirrored onto a status row. */
export const FLEET_COMM_ERROR_SIGNAL_KEY = "__fleetCommError" as const;

/**
 * The status-row DIMENSIONS whose integration-level AGGREGATE rows
 * (`<dimension>:<slug>`, no `/<featureId>` segment) carry mirrored fleet comm
 * errors (REQ-B): the harness result-aggregator / control-plane fleet-health
 * leg mirror onto `d6:<slug>`, and the global lease sweep mirrors onto the
 * reclaimed job's `probe_key` — `d4:<slug>` (smoke), `e2e-demos:<slug>`
 * (demos), and `d5-single-pill-e2e:<slug>` (deep) for the non-d6 families
 * (see harness resolveSweepAggregateKey → aggregateCommError, and the G3f
 * candidate scan in cell-model.ts `decodeCellCommError`).
 *
 * SINGLE SOURCE OF TRUTH shared by two consumers that must stay in lockstep:
 *   - `decodeCellCommError` (cell-model.ts) scans these aggregate keys for
 *     the unreachable/pending overlay, and
 *   - `useLiveStatus`'s supplemental initial fetch re-fetches exactly these
 *     rows WITH `signal` (the bulk initial fetch projects `signal` away — see
 *     `STATUS_LIST_FIELDS` — so without the supplemental fetch a cold page
 *     load would render every active comm-error overlay invisible until an
 *     SSE delta happened to re-deliver the row; CF7-F3 #1).
 */
export const FLEET_COMM_AGGREGATE_DIMENSIONS = [
  "d6",
  "d4",
  "e2e-demos",
  "d5-single-pill-e2e",
] as const;

/**
 * The dashboard's per-cell presentation state: the cell's resolved colour
 * vocabulary (`green` | `amber` | `red` | `gray`, i.e. the `ChipColor` the cell
 * already renders) PLUS the comm-error overlay `"unreachable"`. A PRESENTATION
 * type only — never a persisted column.
 *
 * This is the dashboard analogue of the harness `FleetSurfaceState`
 * (`ProbeState | "unreachable" | "pending"`). The dashboard's cell render model uses
 * `ChipColor` (with `gray` for no-data and `amber` for degraded) rather than
 * the raw probe `State`, so the union is expressed over `ChipColor` to avoid an
 * unsafe widen of the no-data `gray` case through `State`.
 */
export type FleetSurfaceState =
  | "green"
  | "amber"
  | "red"
  | "gray"
  | "unreachable"
  // A `worker-reclaimed-pending` comm error: the job's lease lapsed and the
  // control-plane re-queued it (back in flight). A NEUTRAL surface — the
  // renderer paints it gray, distinct from both the red `"unreachable"` crash
  // overlay and the cell's last-known probe colour — so a routine teardown
  // never flaps the service red.
  | "pending";

/**
 * Extract a `PoolCommError` from a status-row signal blob, or `undefined` when
 * none is present / the embedded value is malformed. Inverse of the harness
 * `commErrorToStatusSignal` writer; structurally identical to the harness
 * `commErrorFromStatusSignal` reader. Pure; unit-tested.
 *
 * The dashboard read layer (REQ-B) uses this to decide whether to render the
 * distinct `"unreachable"` overlay on a cell. Malformed payloads decode to
 * `undefined` (fail-safe to the normal probe colour) rather than rendering a
 * half-populated overlay.
 */
export function commErrorFromStatusSignal(
  signal: unknown,
): PoolCommError | undefined {
  // Array.isArray (BOTH levels): arrays are typeof "object", and an array
  // carrying the signal key (here) or comm-error fields (below) as expando
  // properties would otherwise decode as a well-formed PoolCommError — an
  // array is never a valid wire shape at either level.
  if (signal === null || typeof signal !== "object" || Array.isArray(signal)) {
    return undefined;
  }
  const raw = (signal as Record<string, unknown>)[FLEET_COMM_ERROR_SIGNAL_KEY];
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }
  const candidate = raw as Partial<PoolCommError>;
  if (
    !isPoolCommErrorKind(candidate.kind) ||
    typeof candidate.message !== "string" ||
    typeof candidate.observedAt !== "string"
  ) {
    return undefined;
  }
  const out: PoolCommError = {
    kind: candidate.kind,
    message: candidate.message,
    observedAt: candidate.observedAt,
  };
  if (typeof candidate.workerId === "string") out.workerId = candidate.workerId;
  if (typeof candidate.jobId === "string") out.jobId = candidate.jobId;
  return out;
}

/**
 * Companion to `commErrorFromStatusSignal`: does the signal blob CARRY the
 * well-known comm-error key at all, regardless of whether the embedded value
 * decodes? Lets consumers distinguish "key present but undecodable" (a REQ-B
 * overlay written by a NEWER producer — e.g. a new `PoolCommErrorKind` rolled
 * out write-side first — that this reader silently drops; count/log it) from
 * "genuinely absent" (nothing to report) without changing the decode's return
 * contract. Mirrors the decoder's wire-shape guards: a null / non-object /
 * array blob is never a valid signal, so the key cannot be "present" on one.
 * Sibling of the harness contract's `statusSignalHasCommErrorKey`
 * (`showcase/harness/src/fleet/contracts.ts`) — both live OUTSIDE the
 * byte-identity region pinned by `commError-contract-drift.test.ts` (only the
 * `commErrorFromStatusSignal` function source is mirrored). Pure;
 * unit-tested.
 */
export function statusSignalHasCommErrorKey(signal: unknown): boolean {
  if (signal === null || typeof signal !== "object" || Array.isArray(signal)) {
    return false;
  }
  return FLEET_COMM_ERROR_SIGNAL_KEY in signal;
}

export interface StatusRow {
  id: string;
  key: string;
  dimension: string;
  state: State;
  signal: unknown;
  observed_at: string;
  transitioned_at: string;
  fail_count: number;
  first_failure_at: string | null;
}

export type LiveStatusMap = Map<string, StatusRow>;

/**
 * Comma-joined PocketBase `fields` projection for the BULK INITIAL status
 * fetch — every `StatusRow` field EXCEPT `signal`. The `signal` blob (probe
 * output: error messages, diffs, nested objects) is ~61% of the status
 * payload by size. Dropping it from the bulk initial fetch (~2455 rows across
 * ~5 pages) is the dominant transfer-size win for first paint; the live SSE
 * subscription still delivers full rows (`signal` included) for every
 * subsequent delta.
 *
 * `signal` IS read at render time, in three places:
 *   - the drilldown panel and the per-cell banner, which lazy-load the full
 *     row on demand (unaffected by this projection), and
 *   - `buildCellModel` → `decodeCellCommError` (cell-model.ts), which reads
 *     `row.signal` PER CELL on every render to derive the REQ-B
 *     unreachable/pending comm-error overlay. That read cannot lazy-load —
 *     so `useLiveStatus` issues a SUPPLEMENTAL initial fetch (CF7-F3 #1) of
 *     ONLY the comm-error candidate aggregate rows
 *     (`FLEET_COMM_AGGREGATE_DIMENSIONS`, `<dim>:<slug>` keys — a few rows
 *     per integration, not the whole collection) WITH `signal`, keeping the
 *     bulk projection's payload win while making active overlays visible
 *     from a cold load instead of waiting for an SSE re-delivery.
 *
 * Guarded by `live-status.test.ts`: this list must equal `keyof StatusRow`
 * minus `signal`, so a new `StatusRow` field forces a conscious decision about
 * whether it belongs in the lightweight initial projection.
 */
export const STATUS_LIST_FIELDS =
  "id,key,dimension,state,observed_at,transitioned_at,fail_count,first_failure_at";

/**
 * Extends BadgeTone to include the hook-level "error" case (spec §5.4
 * table row for `error` tone — "dashboard offline"). This is NOT a row
 * state; it represents the SSE stream being disconnected.
 */
export type BadgeTone = "green" | "amber" | "red" | "gray" | "blue" | "error";

/** Connection status from the `useLiveStatus` hook. */
export type ConnectionStatus = "connecting" | "live" | "error";

export interface CellState {
  /** Per-badge resolved tones + labels + tooltips. */
  e2e: BadgeRender;
  smoke: BadgeRender;
  health: BadgeRender;
  /**
   * D2 (API) per-integration badge. Sourced from `agent:<slug>` rows
   * emitted by the agent-check probe. Integration-scoped — every feature
   * within the same integration sees the same D2 badge. Does NOT
   * contribute to the rollup (agent is informational, same model as
   * smoke). Stays `gray` / `?` until the agent probe has ticked for
   * this integration.
   */
  d2: BadgeRender;
  /**
   * D4 (chat round-trip + tool round-trip) per-integration badge. Sourced
   * from `chat:<slug>` / `tools:<slug>` rows via `resolveD4Row` — a
   * worst-state fold with the missing-unconditional-chat collapse (see the
   * resolver doc). Integration-scoped — every feature within the same
   * integration sees the same D4 badge. Stays `gray` / `?` until the
   * d4-chat-roundtrip driver has ticked for this integration. Does NOT
   * contribute to the rollup — informational only; the pill's gate already
   * consumes D4 via `buildCellModel` (cell-model.ts), so the drilldown row
   * exists to make that gate's input visible, not to re-derive the verdict.
   */
  d4: BadgeRender;
  /**
   * D5 (deep / multi-turn conversation) per-feature badge. Sourced from
   * `d5:<slug>/<featureId>` rows emitted by the `e2e-deep` driver. Stays
   * `gray` / `?` until the driver has ticked for this (slug, featureType)
   * pair. Does NOT contribute to the rollup — D5 is informational only,
   * the alert engine routes D5 rows independently.
   */
  d5: BadgeRender;
  /**
   * D6 (parity-vs-reference) PER-CELL badge. Sourced from
   * `d6:<slug>/<featureType>` rows emitted by the `e2e-parity` driver and
   * mapped from catalog featureId via CATALOG_TO_D5_KEY (the same bridge as
   * D5). The driver also writes an integration-level `d6:<slug>` aggregate,
   * but the dashboard resolves cells per-cell — the aggregate is red whenever
   * ANY cell fails and would mis-paint green cells red. A missing row resolves
   * to a gray `?` badge. Does NOT contribute to the rollup for the same reason
   * as D5.
   *
   * UNGATED — not for top-level D6 badges. This is the raw per-dimension D6
   * fold with NO verification-ladder gate: a Coverage-tab D6 badge or D6
   * stat MUST consume `CellModel.d6Effective` (cell-model.ts), which
   * collapses a D6 claim to null when the ladder below it (D1-D5) is broken
   * or unverified. The only intended consumer of THIS field is the
   * cell-drilldown's raw per-dimension diagnostic row, where showing the
   * ungated underlying D6 result is the point.
   */
  d6: BadgeRender;
  /** Rollup tone for the cell, by precedence red > degraded > green > error > unknown. */
  rollup: BadgeTone;
}

export interface BadgeRender {
  tone: BadgeTone;
  label: string;
  tooltip: string;
  row: StatusRow | null;
}

export function keyFor(
  dimension: string,
  slug: string,
  featureId?: string,
): string {
  // Defensive: `:` and `/` are the structural delimiters used to parse
  // `<dimension>:<slug>` and `<slug>/<featureId>`. If callers smuggle them
  // into a slug or featureId we silently produce ambiguous keys that
  // collide in the lookup map (e.g. `smoke:a/b` vs `smoke:a` + `/b`).
  // Throw loudly so the bug surfaces at the call site instead of via
  // a phantom missing/duplicate badge downstream.
  if (dimension.includes(":") || dimension.includes("/")) {
    // Same guard as slug/featureId: a colon-bearing dimension would silently
    // parse as a DIFFERENT dimension + slug suffix, and a slash-bearing one
    // would fabricate a phantom feature segment.
    throw new Error(
      `keyFor: dimension must not contain ':' or '/' (got ${JSON.stringify(dimension)})`,
    );
  }
  if (slug.includes(":") || slug.includes("/")) {
    throw new Error(
      `keyFor: slug must not contain ':' or '/' (got ${JSON.stringify(slug)})`,
    );
  }
  if (featureId !== undefined) {
    // An EMPTY featureId is falsy: a bare truthiness guard would skip the
    // delimiter validation AND the per-feature branch below, silently
    // fabricating the integration-aggregate key (`<dimension>:<slug>`) for
    // what the caller meant as a per-feature lookup. Throw loudly instead.
    if (featureId === "") {
      throw new Error(
        `keyFor: featureId must not be empty for a per-feature dimension key (dimension=${JSON.stringify(dimension)}, slug=${JSON.stringify(slug)})`,
      );
    }
    if (featureId.includes(":") || featureId.includes("/")) {
      throw new Error(
        `keyFor: featureId must not contain ':' or '/' (got ${JSON.stringify(featureId)})`,
      );
    }
  }
  return featureId
    ? `${dimension}:${slug}/${featureId}`
    : `${dimension}:${slug}`;
}

/**
 * Catalog feature ID → D5 PB row key suffix. The harness writes D5 rows
 * keyed by `d5:<slug>/<d5FeatureType>`, but the dashboard resolves cells
 * by catalog `featureId`. This map bridges the two namespaces.
 *
 * Mirrors `REGISTRY_TO_D5` in `harness/src/probes/helpers/d5-feature-mapping.ts`.
 */
export const CATALOG_TO_D5_KEY: Readonly<Record<string, readonly string[]>> = {
  "agentic-chat": ["agentic-chat"],
  "tool-rendering": ["tool-rendering"],
  "tool-rendering-default-catchall": ["tool-rendering-default-catchall"],
  "tool-rendering-custom-catchall": ["tool-rendering-custom-catchall"],
  "tool-rendering-reasoning-chain": ["tool-rendering-reasoning-chain"],
  "headless-simple": ["headless-simple"],
  "headless-complete": ["gen-ui-headless-complete"],
  "gen-ui-tool-based": ["gen-ui-custom"],
  "hitl-in-chat": ["hitl-text-input"],
  "hitl-in-chat-booking": ["hitl-text-input"],
  // `hitl` is an alias for hitl-in-chat used by some integrations. The harness
  // remapped the alias to `hitl-text-input` in d5-feature-mapping.ts (the
  // standalone `hitl-steps` D5 script was removed in genuine-pass Phase 0);
  // this mapping mirrors it. See d5-mapping-drift.test.ts for enforcement.
  hitl: ["hitl-text-input"],
  "hitl-in-app": ["hitl-approve-deny"],
  // shared-state-read-write covers ONLY the write half — the read literal
  // is owned by the standalone /demos/shared-state-read recipe-editor probe.
  "shared-state-read-write": ["shared-state-write"],
  "mcp-apps": ["mcp-apps"],
  subagents: ["subagents"],
  // ── LGP D5 coverage wave (mirrors REGISTRY_TO_D5 in
  //    harness/src/probes/helpers/d5-feature-mapping.ts) ──
  // Beautiful Chat: 5 per-pill literals — see harness/_beautiful-chat-shared.ts
  // for why Excalidraw / Calculator / Sales Dashboard / Task Manager are
  // intentionally out of scope for this PR.
  "beautiful-chat": [
    "beautiful-chat-toggle-theme",
    "beautiful-chat-pie-chart",
    "beautiful-chat-bar-chart",
    "beautiful-chat-search-flights",
    "beautiful-chat-schedule-meeting",
  ],
  "chat-slots": ["chat-slots"],
  "chat-customization-css": ["chat-css"],
  "prebuilt-sidebar": ["prebuilt-sidebar"],
  "prebuilt-popup": ["prebuilt-popup"],
  auth: ["auth"],
  multimodal: ["multimodal"],
  "agent-config": ["agent-config"],
  "frontend-tools": ["frontend-tools"],
  "frontend-tools-async": ["frontend-tools-async"],
  // Reasoning family — both demos route through `reasoning-display`.
  "reasoning-custom": ["reasoning-display"],
  "reasoning-default": ["reasoning-display"],
  "shared-state-streaming": ["shared-state-streaming"],
  "readonly-state-agent-context": ["readonly-state-context"],
  "shared-state-read": ["shared-state-read"],
  "declarative-gen-ui": ["gen-ui-declarative"],
  // A2UI error recovery — mirrors d5-feature-mapping.ts REGISTRY_TO_D5.
  "a2ui-recovery": ["a2ui-recovery"],
  "a2ui-fixed-schema": ["gen-ui-a2ui-fixed"],
  "open-gen-ui": ["gen-ui-open"],
  "open-gen-ui-advanced": ["gen-ui-open-advanced"],
  "gen-ui-agent": ["gen-ui-agent"],
  "gen-ui-interrupt": ["gen-ui-interrupt"],
  "interrupt-headless": ["interrupt-headless"],
  "byoc-hashbrown": ["byoc"],
  "byoc-json-render": ["byoc"],
  // langgraph-python's `byoc-*` cells were renamed to `declarative-*`
  // to drop internal jargon. Both ID forms map to the same `byoc` D5
  // featureType so dashboard rolls up either form. Mirrors
  // d5-feature-mapping.ts.
  "declarative-hashbrown": ["byoc"],
  "declarative-json-render": ["byoc"],
  voice: ["voice"],
};

/**
 * Worst-state precedence ranking shared by `resolveD5Row` AND `resolveD6Row`
 * (red > degraded > green): a higher rank dominates the worst-state fold across
 * a multi-key family. Not D5-specific — both per-feature resolvers fold over
 * it, so the name reflects that scope.
 */
const WORST_STATE_RANK: Readonly<Record<State, number>> = {
  red: 3,
  degraded: 2,
  green: 1,
};

/**
 * Worst-state rank for an arbitrary row state (Fix A2). `StatusRow.state` is
 * typed `State` (green|red|degraded), but the harness CAN persist an
 * out-of-vocabulary value at runtime — notably `"error"` (the no-data
 * representation; see harness result-aggregator.ts). A bare
 * `WORST_STATE_RANK[state]` for such a value is `undefined`, and the fold
 * comparison `undefined > n` is `false`, so the row is SILENTLY DROPPED from the
 * worst-state fold instead of surfacing. Treat an unknown state as the MOST
 * SEVERE (a rank above every known state) so it surfaces as the worst rather
 * than vanishing — an unrecognized signal must never be silently swallowed.
 * Mirrors `cell-model.ts`'s `rankOfState`.
 */
const UNKNOWN_WORST_STATE_RANK = Number.POSITIVE_INFINITY;
function worstStateRank(state: string): number {
  return WORST_STATE_RANK[state as State] ?? UNKNOWN_WORST_STATE_RANK;
}

/**
 * Effective state for staleness folding: a green row whose `observed_at` is
 * older than `maxAgeMs` folds in as `degraded`, so a frozen-green driver can
 * never win the all-green tie and mask a fresh-green sibling. Only green is
 * downgraded — a stale red/degraded row already signals a problem. Mirrors
 * `cell-model.ts`'s per-row stale-green downgrade.
 */
function effectiveState(row: StatusRow, now: number, maxAgeMs: number): State {
  return row.state === "green" && isStale(row, now, maxAgeMs)
    ? "degraded"
    : row.state;
}

/**
 * Resolve the rolled-up D5 row for `(slug, featureId)`.
 *
 * Precedence across the multi-key set (red > degraded > green) — the
 * cell's badge tone reflects the worst-state row in the family. A
 * naive "first non-null wins" or "only red wins" implementation
 * silently masks degraded sub-rows behind green ones; for a cell like
 * `beautiful-chat` which fans out to 5 per-pill keys, that means an
 * amber sub-row would render the cell green and operators would never
 * see the partial regression.
 *
 * Missing rows are treated as not-yet-emitted and are NOT a signal of
 * health — but they also can't be "worst" because we can't compare
 * them to anything. The caller (`resolveCell`) renders gray when no
 * row is returned, which surfaces "no data yet" distinctly from
 * green.
 *
 * Returns the EFFECTIVE (stale-downgraded) winner row — a stale-green
 * winner comes back with `state: "degraded"`, matching the rank that made
 * it win the fold, so `.state` never contradicts the resolution (mirrors
 * `resolveD5` in cell-model.ts and `buildBadge` below). Exported for tests.
 */
export function resolveD5Row(
  live: LiveStatusMap,
  slug: string,
  featureId: string,
  now: number = Date.now(),
): StatusRow | null {
  const d5Keys = CATALOG_TO_D5_KEY[featureId];
  // Unmapped / empty-map feature: no 1P test exists, so return null (gray
  // no-data badge) to match cell-model.ts `resolveD5` (returns exists:false)
  // and depth-utils.ts `isD5Green` (returns false). There is NO direct-key
  // fallback — a feature with real D5 coverage must be in CATALOG_TO_D5_KEY.
  // A direct `d5:<slug>/<featureId>` fallback was removed because it could
  // resolve a green badge from a stale/shared PB row, granting D5 to a cell
  // the chip and depth derivation both treat as having no 1P test, so the
  // badge and chip would visibly contradict each other.
  if (!d5Keys || d5Keys.length === 0) {
    return null;
  }
  // Per-sub-row stale-green→degraded fold applied BEFORE the worst-state
  // comparison (mirrors cell-model.ts `resolveD5`): any stale-green sub-row
  // folds in as degraded so it can never win the all-green tie and mask a
  // fresh-green sibling. D5 uses the e2e (6h) window.
  //
  // STRICT on missing sub-rows (mirrors cell-model.ts `resolveD5` and
  // depth-utils.ts `isD5Green`'s `every(...)`): a multi-key family is credited
  // green ONLY when EVERY mapped sub-row is present. A missing mapped sub-row
  // (`anyMissing`) forces the family out of green and resolves to `null`
  // (no-data → gray badge) UNLESS a present sub-row is red — a present red
  // signals a real failure and dominates no-data.
  let worst: StatusRow | null = null;
  let worstState: State | null = null;
  let anyMissing = false;
  for (const d5Key of d5Keys) {
    const row = live.get(keyFor("d5", slug, d5Key)) ?? null;
    if (!row) {
      anyMissing = true;
      continue;
    }
    const eff = effectiveState(row, now, E2E_STALE_AFTER_MS);
    if (
      worstState === null ||
      worstStateRank(eff) > worstStateRank(worstState)
    ) {
      // Store the EFFECTIVE (downgraded) row so the returned `.state` agrees
      // with the rank that won the fold — mirrors cell-model.ts `resolveD5`.
      worst = eff === row.state ? row : { ...row, state: eff };
      worstState = eff;
    }
  }
  // A missing mapped sub-row makes the family unverified: collapse a
  // present green/degraded fold to no-data (null). A present red-or-worse
  // still dominates (returns that row). RANK-based, not `!== "red"` literal
  // equality: `worstState` is typed `State` but can hold an out-of-vocabulary
  // runtime value (e.g. "error"), which the A2 rank machinery deliberately
  // ranks ABOVE red — literal equality would silently swallow exactly the
  // state the rank fold exists to surface.
  if (
    anyMissing &&
    (worstState === null || worstStateRank(worstState) < WORST_STATE_RANK.red)
  ) {
    return null;
  }
  return worst;
}

/**
 * Resolve the rolled-up D6 (parity-vs-reference) row for `(slug, featureId)`.
 *
 * D6 is PER-CELL, not an integration aggregate. The `e2e-parity` driver emits
 * one `d6:<slug>/<featureType>` row per featureType (the same featureType
 * keyspace D5 uses — both fan out over `demosToFeatureTypes`) PLUS a single
 * aggregate `d6:<slug>` row that is red whenever ANY cell fails. Resolving a
 * cell's badge against that aggregate painted genuinely-green cells red, so we
 * resolve the PER-CELL row, mapped through `CATALOG_TO_D5_KEY` (the same
 * catalog-featureId → featureType bridge D5 uses). The aggregate `d6:<slug>`
 * row no longer drives per-cell rendering.
 *
 * Identical semantics to `resolveD5Row`: worst-state across the mapped family
 * (red > degraded > green), per-sub-row stale-green→degraded fold (E2E 6h
 * window) applied BEFORE the worst-state comparison, and STRICT on missing
 * sub-rows — a missing
 * mapped sub-row collapses a present green/degraded fold to `null` (no-data →
 * gray badge) UNLESS a present sub-row is red (red dominates no-data). An
 * unmapped feature returns `null` (no D6 test exists for it). Like
 * `resolveD5Row`, the returned winner is the EFFECTIVE (stale-downgraded)
 * row, so `.state` agrees with the fold. Exported for tests.
 */
export function resolveD6Row(
  live: LiveStatusMap,
  slug: string,
  featureId: string,
  now: number = Date.now(),
): StatusRow | null {
  const d6Keys = CATALOG_TO_D5_KEY[featureId];
  if (!d6Keys || d6Keys.length === 0) {
    return null;
  }
  let worst: StatusRow | null = null;
  let worstState: State | null = null;
  let anyMissing = false;
  for (const d6Key of d6Keys) {
    const row = live.get(keyFor("d6", slug, d6Key)) ?? null;
    if (!row) {
      anyMissing = true;
      continue;
    }
    const eff = effectiveState(row, now, E2E_STALE_AFTER_MS);
    if (
      worstState === null ||
      worstStateRank(eff) > worstStateRank(worstState)
    ) {
      // Store the EFFECTIVE (downgraded) row — see resolveD5Row.
      worst = eff === row.state ? row : { ...row, state: eff };
      worstState = eff;
    }
  }
  // Rank-based anyMissing collapse — mirrors resolveD5Row: a present
  // red-or-worse (including an out-of-vocab state ranked above red by the A2
  // machinery) dominates no-data; only a green/degraded fold collapses.
  if (
    anyMissing &&
    (worstState === null || worstStateRank(worstState) < WORST_STATE_RANK.red)
  ) {
    return null;
  }
  return worst;
}

/**
 * Resolve the rolled-up D4 (chat round-trip + tool round-trip) row for an
 * integration. INTEGRATION-scoped, not per-feature: the producer
 * (`d4-chat-roundtrip.ts`) writes `chat:<slug>` / `tools:<slug>` rows once
 * per integration.
 *
 * Mirrors `resolveD4` in cell-model.ts, including its EXPECTATION MAPPING:
 *   - `chat:<slug>` is producer-UNCONDITIONAL (written for every probed
 *     integration). A green/degraded fold with the chat row MISSING is an
 *     unverified family and collapses to `null` (no-data → gray badge). A
 *     present RED-or-worse tools row still surfaces — red dominates no-data,
 *     and the collapse guard is RANK-based (not `!== "red"` literal) so an
 *     out-of-vocabulary state ranked above red by the A2 machinery is never
 *     silently swallowed.
 *   - `tools:<slug>` is CONDITIONAL (side-emitted only when the
 *     integration's demos include `tool-rendering`), so its absence stays
 *     LENIENT — a green chat row alone credits D4.
 *
 * Fold semantics match resolveD5Row/resolveD6Row: per-row stale-green →
 * degraded downgrade (D4 uses the 1h `D4_STALE_AFTER_MS` window) applied
 * BEFORE the worst-state comparison; strict `>` rank comparison over
 * `[chat, tools]` scan order, so on an equal rank the chat row is retained.
 * Like its siblings, the returned winner is the EFFECTIVE (stale-downgraded)
 * row, so `.state` always agrees with the rank that won the fold. Exported
 * for tests and consumed by `resolveCell` for the drilldown's D4 badge.
 */
export function resolveD4Row(
  live: LiveStatusMap,
  slug: string,
  now: number = Date.now(),
): StatusRow | null {
  const chatRow = live.get(keyFor("chat", slug)) ?? null;
  const toolsRow = live.get(keyFor("tools", slug)) ?? null;

  if (!chatRow && !toolsRow) {
    return null;
  }

  let worst: StatusRow | null = null;
  let worstState: State | null = null;
  for (const candidate of [chatRow, toolsRow]) {
    if (!candidate) continue;
    const eff = effectiveState(candidate, now, D4_STALE_AFTER_MS);
    if (
      worstState === null ||
      worstStateRank(eff) > worstStateRank(worstState)
    ) {
      // Store the EFFECTIVE (downgraded) row — see resolveD5Row.
      worst =
        eff === candidate.state ? candidate : { ...candidate, state: eff };
      worstState = eff;
    }
  }

  // STRICT on the UNCONDITIONAL row: a missing `chat:<slug>` collapses a
  // below-red fold to no-data (mirrors cell-model.ts resolveD4 and the
  // D5/D6 anyMissing collapse). Rank-based so out-of-vocab states survive.
  if (
    !chatRow &&
    (worstState === null || worstStateRank(worstState) < WORST_STATE_RANK.red)
  ) {
    return null;
  }
  return worst;
}

/* ------------------------------------------------------------------ */
/*  Starter row-group (spec §d / §a)                                    */
/* ------------------------------------------------------------------ */

/**
 * The four smoke levels probed per starter, in dashboard sub-row order.
 * Mirrors `STARTER_LEVELS` in
 * `showcase/harness/src/probes/helpers/starter-mapping.ts` — the harness owns
 * the producer-side list, the dashboard carries its own copy because the two
 * packages do not share a module boundary (the dashboard imports only `@/*`).
 */
export const STARTER_LEVELS = [
  "health",
  "agent",
  "chat",
  "interaction",
] as const;

export type StarterLevel = (typeof STARTER_LEVELS)[number];

/**
 * The dashboard column slugs that HAVE a smoke starter (the 12 mapped columns,
 * §a). This is the dashboard's own copy of the *value set* of `STARTER_TO_COLUMN`
 * in `showcase/harness/src/probes/helpers/starter-mapping.ts` — the harness owns
 * the producer-side remap and the dashboard cannot import across the package
 * boundary, so the column list is mirrored here. The
 * `starter-mapping-drift.test.ts` lint test guards the harness side against slug
 * drift; `live-status.test.ts` asserts THIS set has exactly 12 entries so the
 * 12-mapped / 7-not-supported split (12 + 7 = 19) can never silently rot.
 *
 * A column ABSENT from this set has NO starter and renders the dashboard's
 * existing grey "not supported" ✗ state (§d) — keyed off the MAPPING, never off
 * a missing row, so it never collides with the gray `?` not-yet-run state.
 */
export const STARTER_COLUMNS: ReadonlySet<string> = new Set([
  // 5 drift columns (starter slug ≠ column slug on the producer side)
  "google-adk",
  "langgraph-typescript",
  "strands",
  "ms-agent-dotnet",
  "ms-agent-python",
  // 7 direct columns (starter slug === column slug)
  "crewai-crews",
  "langgraph-fastapi",
  "langgraph-python",
  "agno",
  "llamaindex",
  "mastra",
  "pydantic-ai",
]);

/** `true` when `columnSlug` has a mapped smoke starter (§a). */
export function starterIsSupported(columnSlug: string): boolean {
  return STARTER_COLUMNS.has(columnSlug);
}

/* ------------------------------------------------------------------ */
/*  Starter failure-class taxonomy + two-miss tolerance (pool-fleet C) */
/* ------------------------------------------------------------------ */

/**
 * Keyed starter-failure taxonomy — the DASHBOARD-side mirror of the harness
 * `StarterFailureClass` in
 * `showcase/harness/src/probes/drivers/starter-smoke.ts`. The starter-smoke
 * driver stamps `errorClass` onto the `signal` of every red `starter:<slug>`
 * aggregate and `starter:<slug>/<level>` row.
 *
 * WHY MIRRORED, NOT IMPORTED: the dashboard imports only `@/*` and never reaches
 * across the package boundary into harness source at runtime (same rule that
 * makes `STARTER_COLUMNS` / `CATALOG_TO_D5_KEY` / the comm-error contract local
 * copies of harness producer constants). The
 * `starter-error-class-drift.test.ts` lint test guards the two against drift.
 *
 * SOFT vs HARD split (the whole point of step C):
 *   - SOFT (`transport-error`, `aborted`): a transient transport / cold-start
 *     wake / external-abort hiccup. A SINGLE soft miss must NOT flip the cell
 *     red — that would flap the dashboard on infra noise. It is tolerated until
 *     a SECOND consecutive soft miss confirms the failure.
 *   - HARD (`smoke-failed`): a real HTTP-level content regression. Flips the
 *     cell red IMMEDIATELY — no tolerance.
 */
export const STARTER_FAILURE_CLASSES = [
  "transport-error",
  "smoke-failed",
  "aborted",
] as const;

/** A single keyed starter-failure class. Mirror of harness `StarterFailureClass`. */
export type StarterFailureClass = (typeof STARTER_FAILURE_CLASSES)[number];

/**
 * SOFT (transient) failure classes that earn two-miss tolerance. `smoke-failed`
 * is deliberately ABSENT — a real content regression is a hard red.
 */
const SOFT_STARTER_FAILURE_CLASSES: ReadonlySet<StarterFailureClass> = new Set([
  "transport-error",
  "aborted",
]);

/** Type guard for a valid StarterFailureClass. */
export function isStarterFailureClass(
  value: unknown,
): value is StarterFailureClass {
  return (
    typeof value === "string" &&
    (STARTER_FAILURE_CLASSES as readonly string[]).includes(value)
  );
}

/**
 * Extract the keyed `errorClass` from a starter row's `signal` blob, or
 * `undefined` when none is present / the value is unrecognized. The driver
 * writes `errorClass` at the top level of both the aggregate
 * (`StarterSmokeAggregateSignal`) and per-level (`StarterSmokeLevelSignal`)
 * signal shapes. An unrecognized / malformed value decodes to `undefined`
 * (fail-safe: the row is treated as an untagged failure → hard flip, never a
 * tolerated soft miss on a value we don't understand).
 */
export function starterErrorClassFromSignal(
  signal: unknown,
): StarterFailureClass | undefined {
  if (signal === null || typeof signal !== "object") return undefined;
  const raw = (signal as Record<string, unknown>).errorClass;
  return isStarterFailureClass(raw) ? raw : undefined;
}

/**
 * The consecutive-miss count below which a SOFT failure is tolerated. The
 * harness `status-writer` maintains `fail_count` as the persisted
 * consecutive-red counter (1 on green→red, incremented on sustained red, 0 on
 * red→green), so `fail_count <= 1` is "this is the FIRST red tick" and
 * `fail_count >= 2` is "two+ consecutive misses — confirmed". A SOFT failure
 * flips red only once the count crosses this threshold.
 */
const SOFT_MISS_TOLERANCE_THRESHOLD = 2;

/**
 * Resolve the `starter:<columnSlug>/<level>` row for one starter sub-cell.
 *
 * Sibling to `resolveD5Row`/`resolveD6Row`, but the starter keyspace is flat:
 * one row per (column, level) — there is no multi-key fan-out to fold, so this
 * is a direct lookup, not a worst-state reduction. The 5-state cell vocabulary
 * (§d) is produced by `buildStarterBadge`; this helper only returns the raw
 * row (or `null` for not-yet-run). The not-supported state is mapping-derived
 * and handled by the caller via `starterIsSupported`, NOT inferred here from a
 * missing row.
 */
export function resolveStarterRow(
  live: LiveStatusMap,
  columnSlug: string,
  level: StarterLevel,
): StatusRow | null {
  return live.get(keyFor("starter", columnSlug, level)) ?? null;
}

/** Per-level tooltip copy (§d). `interaction` stays generic. */
const STARTER_LEVEL_DESCRIPTION: Readonly<Record<StarterLevel, string>> = {
  health: "health endpoint responded",
  agent: "agent endpoint reachable (non-404)",
  chat: "chat round-trip via aimock returned a response",
  interaction: "UI interactions work, no console errors",
};

/**
 * Build a `BadgeRender` for one starter sub-cell, applying the FULL 5-state
 * cell vocabulary (§d):
 *
 *   - not-supported  → 🚫 unsupported chip, mapping-derived (`!isSupported`),
 *                      tooltip "Not supported by this framework". An
 *                      integration with NO starter is architecturally
 *                      unsupported in this row, so it renders the SAME 🚫
 *                      treatment the depth-chip/unified-cell already use for
 *                      "framework cannot support this feature" — NOT a
 *                      grey/no-data `?` ("we expected data and got none") and
 *                      NOT a red smoke-failed ✗ ("we tried and failed").
 *                      Resolved FIRST so it can never collide with the gray
 *                      `?` initial state.
 *   - gray `?`       → no row yet (not-yet-run / initial).
 *   - ✓ green        → last probe passed.
 *   - red ✗          → last probe failed (actionable regression).
 *   - `~` amber      → stale: a green row older than STARTER_STALE_AFTER_MS is
 *                      downgraded to degraded (delegated to `buildBadge`).
 *
 * The data-bearing states (green/red/stale/gray) are delegated to the shared
 * `buildBadge` path under the `starter` dimension label — NOT `health`, whose
 * dimension branch renders the up/down/stale word labels; the ✓/✗/~ glyph
 * vocabulary above requires the non-health branch of `formatLabel`. The shared
 * path supplies the same staleness downgrade + tooltip machinery as every
 * other badge; the per-level descriptor is appended to the tooltip.
 */
/**
 * Apply two-miss tolerance to a starter row: a red row keyed with a SOFT
 * failure class (`transport-error` / `aborted`) whose `fail_count` is below
 * `SOFT_MISS_TOLERANCE_THRESHOLD` is downgraded to `degraded` (amber `~`) so a
 * single transient miss does not flip the cell red. Everything else — a
 * non-red row, a HARD (`smoke-failed`) or untagged red, or a soft red at/over
 * the threshold — passes through unchanged.
 *
 * Only `.state` is rewritten (mirrors `buildBadge`'s stale-green fold); the
 * spread preserves `fail_count`, `first_failure_at`, `observed_at`, and the
 * `signal` blob so drilldown metadata is intact and a downstream reader of
 * `.row.state` sees `degraded` (agreeing with the amber tone), not a latent
 * false-red.
 */
function toleratedSoftMissRow(row: StatusRow | null): StatusRow | null {
  if (!row || row.state !== "red") return row;
  const errorClass = starterErrorClassFromSignal(row.signal);
  if (
    errorClass === undefined ||
    !SOFT_STARTER_FAILURE_CLASSES.has(errorClass)
  ) {
    return row;
  }
  if (row.fail_count >= SOFT_MISS_TOLERANCE_THRESHOLD) return row;
  return { ...row, state: "degraded" };
}

export function buildStarterBadge(
  level: StarterLevel,
  isSupported: boolean,
  row: StatusRow | null,
  now: number,
  connection: ConnectionStatus,
): BadgeRender {
  if (!isSupported) {
    // Mapping-derived: this column has no starter (§a). Renders the 🚫
    // "unsupported" treatment (matching depth-chip/unified-cell), which is
    // distinct from BOTH the gray `?` no-data state AND the red smoke-failed
    // ✗. NOT data-derived, so it renders identically before and after the
    // first probe tick. Tone stays slate/gray (the muted unsupported fill);
    // the 🚫 glyph — not the tone — is what communicates "unsupported".
    return {
      tone: "gray",
      label: "🚫",
      tooltip: "Not supported by this framework",
      row: null,
    };
  }
  // Two-miss tolerance (pool-fleet step C): a red row whose failure is keyed
  // SOFT (`transport-error` / `aborted`) and whose consecutive-miss count has
  // NOT yet reached the threshold is TOLERATED — we downgrade it to `degraded`
  // so it renders amber `~` ("transient, not yet actionable") instead of
  // flapping the cell red on a single transport hiccup. HARD (`smoke-failed`)
  // and untagged failures, and soft failures at/over the threshold, pass
  // through unchanged and flip red. The downgrade rewrites ONLY `.state` (same
  // pattern as `buildBadge`'s stale-green→degraded fold) so the connection,
  // tooltip, and drilldown signal are all preserved; the amber tooltip then
  // honestly reports a stale/degraded surface rather than a green ✓.
  const tolerated = toleratedSoftMissRow(row);
  const base = buildBadge(
    "starter",
    tolerated,
    now,
    STARTER_STALE_AFTER_MS,
    connection,
  );
  const descriptor = STARTER_LEVEL_DESCRIPTION[level];
  // Suffix the level descriptor onto the resolved-state tooltip (state +
  // observed_at come from the shared path). For not-yet-run there is no row,
  // so keep buildBadge's "probe pending" copy but still name what would be
  // checked.
  return {
    ...base,
    tooltip:
      connection === "error" ? base.tooltip : `${descriptor} — ${base.tooltip}`,
  };
}

function rowTone(row: StatusRow | null): BadgeTone {
  if (!row) return "gray";
  switch (row.state) {
    case "red":
      return "red";
    case "degraded":
      return "amber";
    case "green":
      return "green";
    default: {
      // Exhaustiveness check: if `State` gains a new variant the type
      // checker fails this assignment, forcing every consumer (tone,
      // label, tooltip) to update in lockstep. Falling through to a
      // distinct `"error"` tone makes the unmapped state visually loud
      // (operator sees something is wrong) instead of silently gray.
      const _exhaustive: never = row.state;
      void _exhaustive;
      return "error";
    }
  }
}

/** Dimension identifiers for formatLabel / formatTooltip. */
export type LiveDimension =
  | "e2e"
  | "smoke"
  | "health"
  | "agent"
  | "chat"
  | "tools"
  | "d4"
  | "d5"
  | "d6"
  | "starter";

function formatLabel(
  dim: LiveDimension,
  row: StatusRow | null,
  stale: boolean,
): string {
  if (!row) return "?";
  if (dim === "health") {
    if (row.state === "green") return "up";
    if (row.state === "red") return "down";
    // Honor the SAME staleness split as formatTooltip: an age-downgraded
    // green (or a degraded row that itself stopped updating) reads "stale",
    // while a FRESH producer-emitted degraded reads "degraded" — hardcoding
    // "stale" here contradicted the "degraded since …" tooltip.
    if (row.state === "degraded") return stale ? "stale" : "degraded";
    // Exhaustiveness check for `health` dim — see rowTone() comment.
    const _exhaustive: never = row.state;
    void _exhaustive;
    return "?";
  }
  switch (row.state) {
    case "red":
      return "✗";
    // degraded must NOT render a green "✓" glyph — it contradicts the
    // tooltip and misleads operators into thinking the signal is healthy.
    // Use "~" to visually match the amber tone.
    case "degraded":
      return "~";
    case "green":
      return "✓";
    default: {
      // Exhaustiveness check (mirrors rowTone). Returning "?" instead of
      // a silent "✓" prevents an unmapped future state from being
      // surfaced as green to operators.
      const _exhaustive: never = row.state;
      void _exhaustive;
      return "?";
    }
  }
}

/**
 * Stringify a `signal` field for tooltip suffix. Returns an empty string
 * for null/undefined/empty objects so callers can blindly concat.
 * Truncates at 80 chars to keep tooltips one-line-ish.
 */
function summarizeSignal(signal: unknown): string {
  if (signal == null) return "";
  if (typeof signal === "string") {
    if (signal.length === 0) return "";
    return signal.length > 80 ? `${signal.slice(0, 77)}...` : signal;
  }
  if (typeof signal === "object") {
    // Skip empty objects/arrays — they're noise, not signal.
    if (Array.isArray(signal) && signal.length === 0) return "";
    if (!Array.isArray(signal) && Object.keys(signal as object).length === 0)
      return "";
    let json: string;
    try {
      json = JSON.stringify(signal);
    } catch {
      return "";
    }
    return json.length > 80 ? `${json.slice(0, 77)}...` : json;
  }
  const s = String(signal);
  return s.length > 80 ? `${s.slice(0, 77)}...` : s;
}

/**
 * `stale` is the SAME per-row staleness check the badge tone derivation uses
 * (`isStale(row, now, maxAgeMs)`, computed by `buildBadge`). It splits the
 * degraded copy: an AGE-DOWNGRADED green (or a degraded row that has itself
 * stopped updating) reads "stale — last seen @ …", while a FRESH
 * producer-emitted degraded reads "degraded since …" — labeling a fresh
 * degraded signal "stale" told operators the row had stopped updating when
 * the producer genuinely emitted degradation on a recent tick.
 */
function formatTooltip(
  dim: LiveDimension,
  row: StatusRow | null,
  connection: ConnectionStatus,
  stale: boolean,
): string {
  if (connection === "error") {
    // When the SSE stream is dead AND we have a recent red/degraded row,
    // surface the row's last-known state alongside the offline banner so
    // operators can triage without waiting for reconnect.
    if (row && (row.state === "red" || row.state === "degraded")) {
      return `dashboard offline (§5.3) — last observed: ${dim} ${row.state} since ${formatTs(row.transitioned_at)}`;
    }
    return "dashboard offline (§5.3)";
  }
  if (!row) return "no data — probe pending";
  switch (row.state) {
    case "green":
      return `${dim} green since ${formatTs(row.observed_at)}`;
    case "red": {
      const base = `${dim} red since ${formatTs(row.first_failure_at ?? row.transitioned_at)}`;
      const sig = summarizeSignal(row.signal);
      return sig ? `${base} — ${sig}` : base;
    }
    case "degraded": {
      // The hardcoded ">6h" was a lie — the threshold lives in the
      // producer config and is not asserted in copy. Just say "stale".
      // `observed_at` is when this row was last *seen* in any state
      // (most recent producer tick), NOT when it last passed green —
      // for a degraded row that timestamp is when degradation was
      // last observed. Earlier copy ("last pass @ ...") was misleading
      // operators into reading it as the last green tick.
      if (stale) {
        const base = `${dim} stale — last seen @ ${formatTs(row.observed_at)}`;
        const sig = summarizeSignal(row.signal);
        return sig ? `${base} — ${sig}` : base;
      }
      // FRESH producer-emitted degraded: the row IS updating — the signal is
      // genuine degradation, not a frozen row. Mirrors the red copy's
      // "since" anchored on the state transition.
      const base = `${dim} degraded since ${formatTs(row.transitioned_at)}`;
      const sig = summarizeSignal(row.signal);
      return sig ? `${base} — ${sig}` : base;
    }
    default: {
      // Exhaustiveness check: forces the switch to be updated when a
      // new `State` variant lands. Returns a loud fallback instead of
      // an empty tooltip so the unmapped state is visible. We capture
      // the raw state via a runtime read so the message can include it
      // without tripping the `never`-narrowed type.
      const _exhaustive: never = row.state;
      void _exhaustive;
      return `${dim} unknown state: ${String((row as { state: unknown }).state)}`;
    }
  }
}

export interface ResolveCellOptions {
  /**
   * Optional live-hook connection status. When `"error"`, the cell rollup
   * is forced to `"error"` tone (spec §5.4 precedence clause:
   * "Hook `status === 'error'` (see §5.3)"), and per-badge tooltips are
   * overridden to "dashboard offline (§5.3)".
   */
  connection?: ConnectionStatus;
  /**
   * Reference time for staleness downgrade, defaulting to `Date.now()`.
   * Co-rendering call sites thread the SAME `now` they pass to
   * `buildCellModel` so the chip and the badges agree on which green rows
   * are stale.
   */
  now?: number;
}

/**
 * Build a `BadgeRender` for one dimension, applying the stale-green→degraded
 * downgrade: a green row older than `maxAgeMs` renders amber with the "stale"
 * tooltip, so a frozen-green driver no longer presents as healthy. The
 * returned `.row` is the EFFECTIVE (downgraded) row so `.row.state` agrees
 * with `.tone` — a consumer reading `.row.state` sees `degraded`, not a
 * latent false-green. Only `.state` is rewritten; the spread preserves all
 * other producer fields (`fail_count`, `first_failure_at`, `observed_at`,
 * `signal`) so drilldown metadata is unaffected. A missing row, or a
 * non-green row, passes through unchanged.
 */
function buildBadge(
  dim: LiveDimension,
  row: StatusRow | null,
  now: number,
  maxAgeMs: number,
  connection: ConnectionStatus,
): BadgeRender {
  // ONE staleness check shared by the tone downgrade AND the tooltip copy
  // split (see formatTooltip's `stale` param) so the two can never disagree.
  const stale = row !== null && isStale(row, now, maxAgeMs);
  const effRow: StatusRow | null =
    row && row.state === "green" && stale ? { ...row, state: "degraded" } : row;
  return {
    tone: rowTone(effRow),
    label: formatLabel(dim, effRow, stale),
    tooltip: formatTooltip(dim, effRow, connection, stale),
    row: effRow,
  };
}

/**
 * Pure resolver: given a live-status map + (slug, featureId), return the
 * per-badge and rolled-up cell state.
 *
 * Multi-dimension precedence (spec §5.4):
 *   red > degraded > green > error > unknown
 *
 * Rollup contributors: health + e2e only. smokeRow was dropped from the
 * rollup in Phase 3 (Decision #7) because the producer writes
 * integration-scoped smoke:<slug>, not feature-scoped smoke:<slug>/<feature>.
 * The L1 signal now lives in the per-integration strip.
 */
export function resolveCell(
  live: LiveStatusMap,
  slug: string,
  featureId: string,
  opts: ResolveCellOptions = {},
): CellState {
  const connection: ConnectionStatus = opts.connection ?? "live";
  const now: number = opts.now ?? Date.now();

  const healthRow = live.get(keyFor("health", slug)) ?? null;
  const e2eRow = live.get(keyFor("e2e", slug, featureId)) ?? null;
  // The smoke producer emits integration-scoped `smoke:<slug>` rows, NOT
  // per-feature `smoke:<slug>/<featureId>`. Looking up the per-feature
  // shape always misses, leaving every smoke badge gray. Use the
  // integration-scoped key so the badge actually populates.
  const smokeRow = live.get(keyFor("smoke", slug)) ?? null;
  // D2 / agent row: integration-scoped `agent:<slug>`, emitted by the
  // agent-check probe. Every feature within the same integration sees
  // the same D2 badge. Informational — does NOT contribute to the
  // rollup (same model as smoke).
  const agentRow = live.get(keyFor("agent", slug)) ?? null;
  // D5 + D6 per-feature rows, both keyed `<dim>:<slug>/<featureType>` and
  // mapped from catalog featureId via CATALOG_TO_D5_KEY. D5 rows come from
  // the e2e-deep driver; D6 rows from the e2e-parity driver, which emits one
  // `d6:<slug>/<featureType>` row per featureType (PLUS an integration-level
  // `d6:<slug>` aggregate the dashboard no longer reads per-cell — it is red
  // whenever ANY cell fails and would paint green cells red).
  // Informational — neither contributes to the rollup (alert engine routes
  // them independently, same model as smoke). A missing row resolves to a
  // gray "?" badge, the expected resting state for cells outside their
  // weekly-rotation slot.
  const d5Row = resolveD5Row(live, slug, featureId, now);
  const d6Row = resolveD6Row(live, slug, featureId, now);
  // D4 integration-scoped fold over `chat:<slug>`/`tools:<slug>` — same
  // informational (non-rollup) model as d2/d5/d6; the pill's verification
  // gate consumes D4 separately via buildCellModel.
  const d4Row = resolveD4Row(live, slug, now);

  // Rollup contributors: health + e2e (Decision #7: smokeRow dropped).
  // Each contributor's stale-green is downgraded to degraded BEFORE tone
  // derivation, using its own window — health uses the liveness (45m) window,
  // e2e uses the e2e (6h) window — so a frozen-green driver can no longer
  // roll the cell up to green. Only green is downgraded; a stale red/degraded
  // row already signals a problem and is left as-is.
  const healthEff = healthRow
    ? effectiveState(healthRow, now, LIVENESS_STALE_AFTER_MS)
    : null;
  const e2eEff = e2eRow
    ? effectiveState(e2eRow, now, E2E_STALE_AFTER_MS)
    : null;
  const contributorStates: Array<State | null> = [healthEff, e2eEff];
  // Fold contributor states through the A2 rank machinery (worstStateRank),
  // NOT literal includes() checks: a `State`-typed value can hold an
  // out-of-vocabulary runtime state (e.g. "error" — see worstStateRank),
  // which a literal fold matches against neither "red" nor "degraded", so
  // the cell rolls up GRAY (benign no-data) while the contributor's own
  // badge renders the loud "error" tone. The rank machinery deliberately
  // ranks an unknown state ABOVE red, so it rolls up at least red-severity
  // instead of being silently swallowed (the documented precedence
  // red > degraded > green > error > unknown never demotes a present
  // failure below red).
  let worstContributorRank = 0;
  for (const s of contributorStates) {
    if (s === null) continue;
    const rank = worstStateRank(s);
    if (rank > worstContributorRank) worstContributorRank = rank;
  }
  const hasAnyRed = worstContributorRank >= WORST_STATE_RANK.red;
  const hasAnyAmber = worstContributorRank === WORST_STATE_RANK.degraded;
  // `allGreen` is gated on `connection !== "error"` to avoid the stale-green
  // lie (spec §5.3): when the SSE stream has gone dark, any cached green
  // rows are by definition stale and must NOT be presented as authoritative
  // "all good". Red still wins (a real red signal must surface even if the
  // stream is down — see the C5 F14 test), but a cell that would otherwise
  // read green becomes `error` tone so operators see the offline banner
  // rather than a misleading green check.
  // Both health AND e2e must be present and green. Treating a missing e2e
  // row as "green-eligible" lets a brand-new cell read green before any
  // e2e probe has actually ticked, which is a different flavour of the
  // stale-green lie.
  const allGreen =
    connection !== "error" && healthEff === "green" && e2eEff === "green";

  let rollup: BadgeTone;
  if (hasAnyRed) {
    rollup = "red";
  } else if (hasAnyAmber) {
    rollup = "amber";
  } else if (allGreen) {
    rollup = "green";
  } else if (connection === "error") {
    // Error precedence: stream error takes precedence over missing data so
    // infra problems don't hide behind silent "unknown" cells.
    rollup = "error";
  } else {
    rollup = "gray";
  }

  // Per-badge stale-green downgrade windows: e2e/d5/d6 use the e2e (6h)
  // window; d4 uses the D4 (1h) window; health/d2(agent)/smoke use the
  // tighter liveness (45m) window.
  return {
    e2e: buildBadge("e2e", e2eRow, now, E2E_STALE_AFTER_MS, connection),
    smoke: buildBadge(
      "smoke",
      smokeRow,
      now,
      LIVENESS_STALE_AFTER_MS,
      connection,
    ),
    health: buildBadge(
      "health",
      healthRow,
      now,
      LIVENESS_STALE_AFTER_MS,
      connection,
    ),
    d2: buildBadge("agent", agentRow, now, LIVENESS_STALE_AFTER_MS, connection),
    d4: buildBadge("d4", d4Row, now, D4_STALE_AFTER_MS, connection),
    d5: buildBadge("d5", d5Row, now, E2E_STALE_AFTER_MS, connection),
    d6: buildBadge("d6", d6Row, now, E2E_STALE_AFTER_MS, connection),
    rollup,
  };
}

/**
 * Shallow equality on the row fields that change observably between
 * SSE updates: `id`, `key`, `state`, `observed_at`, `transitioned_at`,
 * `fail_count`, `first_failure_at`, plus the PRESENCE (not content) of
 * `signal`.
 *
 * `fail_count` and `first_failure_at` are observable on their own:
 * `first_failure_at` is load-bearing in `formatTooltip` ("red since ..."),
 * and `fail_count` feeds the drilldown/alerting surfaces — a delta moving
 * only one of them must not be discarded. `id` changes when a status row is
 * deleted and recreated upstream (same key, fresh PB record id); swallowing
 * that delta would strand the stale id in the map and break any id-keyed
 * follow-up fetch.
 *
 * Signal handling: the initial fetch projection drops `signal`, so initial
 * rows arrive with `signal === undefined` and rely on SSE deltas to deliver
 * the populated signal (the "SSE delivers full rows" contract that
 * cell-pieces.tsx / cell-drilldown.tsx rely on). A delta that flips signal
 * PRESENCE — `undefined` ⇄ defined — is therefore observable and must NOT be a
 * no-op, or the signal-bearing row would be discarded and the signal-less row
 * would survive. We compare presence only (`(a.signal === undefined) !==
 * (b.signal === undefined)`), keeping the cheap-comparison philosophy: we still
 * avoid a deep-equal on `signal` because it may be a large nested object, and a
 * same-presence content change is acceptable to treat as a no-op since
 * `observed_at` / `transitioned_at` normally move when content meaningfully
 * changes (and the producer-side state machine already collapses semantically
 * equivalent signals upstream).
 */
function rowsAreNoop(prev: unknown, next: unknown): boolean {
  if (!coreRowFieldsEqual(prev, next)) return false;
  if (prev === next) return true;
  const a = prev as Record<string, unknown>;
  const b = next as Record<string, unknown>;
  return (a.signal === undefined) === (b.signal === undefined);
}

/**
 * Equality on the SIGNAL-INDEPENDENT observable row fields (`id`, `key`,
 * `state`, `observed_at`, `transitioned_at`, `fail_count`,
 * `first_failure_at`) — `rowsAreNoop` minus the signal-presence term.
 *
 * Split out for `mergeRowsToMap`'s divergence warn (CF7-F3 #5): the initial
 * bulk fetch projects `signal` away while SSE deltas and the comm-error
 * supplemental fetch deliver full rows, so the SAME logical row legitimately
 * appears with and without `signal` depending on provenance. The reducer
 * (`upsertByKey` → `rowsAreNoop`) MUST keep treating that presence flip as
 * observable (the signal-bearing row has to replace the projected one), but
 * the disjoint-key invariant warn must NOT fire on it — it is expected
 * provenance, not an upstream keyspace violation.
 */
function coreRowFieldsEqual(prev: unknown, next: unknown): boolean {
  if (prev === next) return true;
  if (
    typeof prev !== "object" ||
    typeof next !== "object" ||
    prev === null ||
    next === null
  )
    return false;
  const a = prev as Record<string, unknown>;
  const b = next as Record<string, unknown>;
  return (
    a.id === b.id &&
    a.key === b.key &&
    a.state === b.state &&
    a.observed_at === b.observed_at &&
    a.transitioned_at === b.transitioned_at &&
    a.fail_count === b.fail_count &&
    a.first_failure_at === b.first_failure_at
  );
}

/**
 * Upsert a row by `key` into an array preserving ordering. Used by the
 * live-subscribe reducer when the SSE stream emits a record update.
 *
 * Returns the SAME array reference when the incoming row is a no-op
 * (id + key + state + observed_at + transitioned_at + fail_count +
 * first_failure_at unchanged AND signal presence unchanged) so React's
 * reference-equality short-circuit can skip re-rendering downstream
 * memoised components.
 *
 * `T` is constrained to `StatusRow` (not a bare `{ key: string }`): the no-op
 * decision compares StatusRow's discriminating fields, so a looser bound
 * would let `rowsAreNoop` vacuously match a non-StatusRow type whose fields
 * are all `undefined` — silently swallowing every update for that type.
 */
export function upsertByKey<T extends StatusRow>(rows: T[], next: T): T[] {
  const idx = rows.findIndex((r) => r.key === next.key);
  if (idx === -1) return [...rows, next];
  const existing = rows[idx];
  if (existing !== undefined && rowsAreNoop(existing, next)) {
    return rows;
  }
  const out = rows.slice();
  out[idx] = next;
  return out;
}

/**
 * Merge N per-dimension row arrays into a single `LiveStatusMap` keyed by
 * `row.key`. Later entries win on collision — but each dimension is
 * supposed to own a disjoint slice of the keyspace, so a collision
 * means the disjoint-key invariant has been violated upstream.
 * Surface it via `console.warn` so dev mode catches the regression
 * without changing return semantics (last-wins is still fine for
 * eventual consistency).
 *
 * The warning fires only on GENUINE divergence — two rows with the same key
 * but a different observable state (compared via `coreRowFieldsEqual`, the
 * id/key/state/observed_at/transitioned_at/fail_count/first_failure_at
 * shallow check the reducer uses — WITHOUT the reducer's signal-presence
 * term, CF7-F3 #5: the initial fetch projects `signal` away while SSE deltas
 * and the comm-error supplemental fetch deliver full rows, so a
 * `signal` undefined⇄defined flip between groups is expected provenance, not
 * a keyspace violation, and must not warn).
 * Identical-content-but-different-reference rows (e.g. the same producer row
 * re-allocated across two groups) are NOT a real invariant violation and used
 * to fire a noisy false warning under the old reference-based `prior !== r`
 * check.
 */
export function mergeRowsToMap(...rowGroups: StatusRow[][]): LiveStatusMap {
  const map: LiveStatusMap = new Map();
  for (const rows of rowGroups) {
    for (const r of rows) {
      const prior = map.get(r.key);
      if (prior !== undefined && !coreRowFieldsEqual(prior, r)) {
        // eslint-disable-next-line no-console
        console.warn(
          `mergeRowsToMap: disjoint-key invariant violated for key="${r.key}" ` +
            `(prior id=${prior.id}, new id=${r.id})`,
        );
      }
      map.set(r.key, r);
    }
  }
  return map;
}
