/**
 * Shared types + key helpers for the live-status path (§5.4, §5 of the
 * showcase-ops design spec).
 *
 * PB row keys: `<dimension>:<slug>` for integration-level dimensions
 * (e.g. `health`, `agent`, `chat`, `tools`), or
 * `<dimension>:<slug>/<featureId>` for per-feature dimensions
 * (e.g. `smoke`, `e2e`, `d5`, `d6`). The `d5:` / `d6:` per-feature rows
 * are emitted by the `e2e-deep` and `e2e-parity` drivers respectively
 * (D5/D6 spec) — featureId here is the D5 featureType (e.g.
 * `agentic-chat`) so the existing per-cell lookup pattern stays uniform.
 */

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

function formatTooltip(
  dim: LiveDimension,
  row: StatusRow | null,
  connection: ConnectionStatus,
): string {
  if (connection === "error") return "dashboard offline (§5.3)";
  if (!row) return "no data — probe pending";
  switch (row.state) {
    case "green":
      return `${dim} green since ${row.observed_at}`;
    case "red":
      return `${dim} red since ${row.first_failure_at ?? row.transitioned_at}`;
    case "degraded":
      return `${dim} stale (>6h) — last pass @ ${row.observed_at}`;
    default:
      return "";
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
  const smokeRow = live.get(keyFor("smoke", slug, featureId)) ?? null;
  // D5 / D6 per-feature rows (`d5:<slug>/<featureType>` /
  // `d6:<slug>/<featureType>`) emitted by the e2e-deep / e2e-parity
  // drivers. Informational — they do NOT contribute to the rollup
  // (alert engine routes them independently, same model as smoke). A
  // missing row resolves to a gray "?" badge, which is the expected
  // resting state for D6 cells outside their weekly-rotation slot.
  const d5Row = live.get(keyFor("d5", slug, featureId)) ?? null;
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
  const allGreen =
    connection !== "error" &&
    healthRow?.state === "green" &&
    (e2eRow === null || e2eRow.state === "green");

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
 * Upsert a row by `key` into an array preserving ordering. Used by the
 * live-subscribe reducer when the SSE stream emits a record update.
 */
export function upsertByKey<T extends { key: string }>(
  rows: T[],
  next: T,
): T[] {
  const idx = rows.findIndex((r) => r.key === next.key);
  if (idx === -1) return [...rows, next];
  const out = rows.slice();
  out[idx] = next;
  return out;
}

/**
 * Merge N per-dimension row arrays into a single `LiveStatusMap` keyed by
 * `row.key`. Later entries win on collision (expected: each dimension
 * owns disjoint keys).
 */
export function mergeRowsToMap(...rowGroups: StatusRow[][]): LiveStatusMap {
  const map: LiveStatusMap = new Map();
  for (const rows of rowGroups) {
    for (const r of rows) map.set(r.key, r);
  }
  return map;
}
