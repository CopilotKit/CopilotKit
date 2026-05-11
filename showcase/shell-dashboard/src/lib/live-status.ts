/**
 * Shared types + key helpers for the live-status path (§5.4, §5 of the
 * showcase-harness design spec).
 *
 * PB row keys: `<dimension>:<slug>` for integration-level dimensions
 * (e.g. `health`, `agent`, `chat`, `tools`), or
 * `<dimension>:<slug>/<featureId>` for per-feature dimensions
 * (e.g. `smoke`, `e2e`, `d5`, `d6`). The `d5:` / `d6:` per-feature rows
 * are emitted by the `e2e-deep` and `e2e-parity` drivers respectively
 * (D5/D6 spec) — featureId here is the D5 featureType (e.g.
 * `agentic-chat`) so the existing per-cell lookup pattern stays uniform.
 */

import { formatTs } from "./format-ts";

export type State = "green" | "red" | "degraded";

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
   * D5 (deep / multi-turn conversation) per-feature badge. Sourced from
   * `d5:<slug>/<featureId>` rows emitted by the `e2e-deep` driver. Stays
   * `gray` / `?` until the driver has ticked for this (slug, featureType)
   * pair. Does NOT contribute to the rollup — D5 is informational only,
   * the alert engine routes D5 rows independently.
   */
  d5: BadgeRender;
  /**
   * D6 (parity-vs-reference) per-feature badge. Sourced from
   * `d6:<slug>/<featureId>` rows emitted by the `e2e-parity` driver. D6
   * runs on a weekly rotation per integration so most cells stay `gray` /
   * `?` between rotations — that's expected, NOT a signal of stale data.
   * Does NOT contribute to the rollup for the same reason as D5.
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
  if (slug.includes(":") || slug.includes("/")) {
    throw new Error(
      `keyFor: slug must not contain ':' or '/' (got ${JSON.stringify(slug)})`,
    );
  }
  if (featureId && (featureId.includes(":") || featureId.includes("/"))) {
    throw new Error(
      `keyFor: featureId must not contain ':' or '/' (got ${JSON.stringify(featureId)})`,
    );
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
 */
const D5_STATE_RANK: Readonly<Record<State, number>> = {
  red: 3,
  degraded: 2,
  green: 1,
};

function resolveD5Row(
  live: LiveStatusMap,
  slug: string,
  featureId: string,
): StatusRow | null {
  const d5Keys = CATALOG_TO_D5_KEY[featureId];
  if (!d5Keys) {
    return live.get(keyFor("d5", slug, featureId)) ?? null;
  }
  let worst: StatusRow | null = null;
  for (const d5Key of d5Keys) {
    const row = live.get(keyFor("d5", slug, d5Key)) ?? null;
    if (!row) continue;
    if (!worst || D5_STATE_RANK[row.state] > D5_STATE_RANK[worst.state]) {
      worst = row;
    }
  }
  return worst;
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
  | "d5"
  | "d6";

function formatLabel(dim: LiveDimension, row: StatusRow | null): string {
  if (!row) return "?";
  if (dim === "health") {
    if (row.state === "green") return "up";
    if (row.state === "red") return "down";
    if (row.state === "degraded") return "stale";
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

function formatTooltip(
  dim: LiveDimension,
  row: StatusRow | null,
  connection: ConnectionStatus,
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
      const base = `${dim} stale — last seen @ ${formatTs(row.observed_at)}`;
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
  // D5 / D6 per-feature rows (`d5:<slug>/<featureType>` /
  // `d6:<slug>/<featureType>`) emitted by the e2e-deep / e2e-parity
  // drivers. Informational — they do NOT contribute to the rollup
  // (alert engine routes them independently, same model as smoke). A
  // missing row resolves to a gray "?" badge, which is the expected
  // resting state for D6 cells outside their weekly-rotation slot.
  const d5Row = resolveD5Row(live, slug, featureId);
  const d6Row = live.get(keyFor("d6", slug, featureId)) ?? null;

  // Rollup contributors: health + e2e (Decision #7: smokeRow dropped).
  const contributors: Array<StatusRow | null> = [healthRow, e2eRow];
  const toneSet = contributors.map(rowTone);
  const hasAnyRed = toneSet.includes("red");
  const hasAnyAmber = toneSet.includes("amber");
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
    connection !== "error" &&
    healthRow?.state === "green" &&
    e2eRow?.state === "green";

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

  return {
    e2e: {
      tone: rowTone(e2eRow),
      label: formatLabel("e2e", e2eRow),
      tooltip: formatTooltip("e2e", e2eRow, connection),
      row: e2eRow,
    },
    smoke: {
      tone: rowTone(smokeRow),
      label: formatLabel("smoke", smokeRow),
      tooltip: formatTooltip("smoke", smokeRow, connection),
      row: smokeRow,
    },
    health: {
      tone: rowTone(healthRow),
      label: formatLabel("health", healthRow),
      tooltip: formatTooltip("health", healthRow, connection),
      row: healthRow,
    },
    d2: {
      tone: rowTone(agentRow),
      label: formatLabel("agent", agentRow),
      tooltip: formatTooltip("agent", agentRow, connection),
      row: agentRow,
    },
    d5: {
      tone: rowTone(d5Row),
      label: formatLabel("d5", d5Row),
      tooltip: formatTooltip("d5", d5Row, connection),
      row: d5Row,
    },
    d6: {
      tone: rowTone(d6Row),
      label: formatLabel("d6", d6Row),
      tooltip: formatTooltip("d6", d6Row, connection),
      row: d6Row,
    },
    rollup,
  };
}

/**
 * Shallow equality on the row fields that change observably between
 * SSE updates. We deliberately avoid deep-equal on `signal` because it
 * may be a large nested object — the producer-side state machine
 * already collapses semantically equivalent signals upstream.
 */
function rowsAreNoop(prev: unknown, next: unknown): boolean {
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
    a.key === b.key &&
    a.state === b.state &&
    a.observed_at === b.observed_at &&
    a.transitioned_at === b.transitioned_at
  );
}

/**
 * Upsert a row by `key` into an array preserving ordering. Used by the
 * live-subscribe reducer when the SSE stream emits a record update.
 *
 * Returns the SAME array reference when the incoming row is a no-op
 * (key + state + observed_at + transitioned_at unchanged) so React's
 * reference-equality short-circuit can skip re-rendering downstream
 * memoised components.
 */
export function upsertByKey<T extends { key: string }>(
  rows: T[],
  next: T,
): T[] {
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
 */
export function mergeRowsToMap(...rowGroups: StatusRow[][]): LiveStatusMap {
  const map: LiveStatusMap = new Map();
  for (const rows of rowGroups) {
    for (const r of rows) {
      const prior = map.get(r.key);
      if (prior !== undefined && prior !== r) {
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
