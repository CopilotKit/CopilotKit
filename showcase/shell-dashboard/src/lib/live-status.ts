/**
 * Shared types + key helpers for the live-status path (§5.4, §5 of the
 * showcase-ops design spec).
 *
 * PB row keys: `<dimension>:<slug>` for integration-level dimensions
 * (e.g. `health`), or `<dimension>:<slug>/<featureId>` for per-feature
 * dimensions (e.g. `smoke`, `e2e`, `qa`).
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
  qa: BadgeRender;
  health: BadgeRender;
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
    default:
      return "gray";
  }
}

function formatLabel(
  dim: "e2e" | "smoke" | "qa" | "health",
  row: StatusRow | null,
): string {
  if (!row) return "?";
  if (dim === "health") {
    if (row.state === "green") return "up";
    if (row.state === "red") return "down";
    // degraded → "stale" matches the tooltip copy instead of rendering "?"
    // which would read as "no data".
    return "stale";
  }
  if (row.state === "red") return "✗";
  // degraded must NOT render a green "✓" glyph — it contradicts the tooltip
  // and misleads operators into thinking the signal is healthy. Use "~" to
  // visually match the amber tone.
  if (row.state === "degraded") return "~";
  return "✓";
}

function formatTooltip(
  dim: "e2e" | "smoke" | "qa" | "health",
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
 * Only smoke, health, and e2e contribute to the rollup. QA is informational
 * and does not feed the rollup — it stays a per-cell badge.
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
  const qaRow = live.get(keyFor("qa", slug, featureId)) ?? null;

  // Rollup contributors: smoke, health, e2e — NOT qa.
  const contributors: Array<StatusRow | null> = [smokeRow, healthRow, e2eRow];
  const toneSet = contributors.map(rowTone);
  const hasAnyRed = toneSet.includes("red");
  const hasAnyAmber = toneSet.includes("amber");
  const allGreen =
    smokeRow?.state === "green" &&
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
    qa: {
      tone: rowTone(qaRow),
      label: formatLabel("qa", qaRow),
      tooltip: formatTooltip("qa", qaRow, connection),
      row: qaRow,
    },
    health: {
      tone: rowTone(healthRow),
      label: formatLabel("health", healthRow),
      tooltip: formatTooltip("health", healthRow, connection),
      row: healthRow,
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
