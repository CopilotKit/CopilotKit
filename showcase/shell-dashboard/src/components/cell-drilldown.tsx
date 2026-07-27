"use client";
/**
 * CellDrilldown — popover panel showing per-badge dimension detail for a
 * single (integration, feature) cell.
 *
 * Renders all relevant badge dimensions (d6/Parity, d5/1P, d4/BE (Agent),
 * e2e/UI, d2/API (HTTP), health) with tone, label, and — for red/amber badges —
 * failure metadata presented as readable key-value pairs with the full
 * signal collapsible for debugging.
 *
 * The legacy `smoke` row was dropped: the smoke endpoint was the same
 * contract as `/health` on the same service (pure redundancy) and is no
 * longer probed. The `e2e` row is labeled "UI (Frontend)" — the
 * underlying probe key (`e2e:<slug>/<feature>`) is preserved on
 * PocketBase for backward compatibility with historical rows.
 */
import { useEffect, useMemo, useState } from "react";
import { resolveCell } from "@/lib/live-status";
import type {
  CellState,
  BadgeRender,
  LiveStatusMap,
  ConnectionStatus,
} from "@/lib/live-status";
import { formatTs } from "@/lib/format-ts";
import { getPb } from "@/lib/pb";
import { TONE_CLASS, DOT_BG } from "./badges";
import { useWorkerRuns, familyForProbeKey } from "@/lib/worker-runs-context";
import type { WorkerFamilySummary } from "@/lib/ops-api";

export interface CellDrilldownProps {
  slug: string;
  featureId: string;
  integrationName: string;
  featureName: string;
  liveStatus: LiveStatusMap;
  connection?: ConnectionStatus;
  onClose: () => void;
}

/**
 * Dimension metadata for display ordering (descending depth). Labels follow
 * the legend's canonical taxonomy (adaptive-legend.tsx): D4 = "BE (Agent)"
 * (single chat message round-trip — agent processes a message end-to-end),
 * D3/e2e = "UI (Frontend)" (the demo page renders in a browser), D2 =
 * "API (HTTP)" (backend service is up and HTTP-reachable). BadgeRow derives
 * its data-testid from the label, so labels must stay unique across rows.
 *
 * The `smoke` row was dropped — the smoke endpoint was redundant with
 * /health on the same service and is no longer probed. `CellState.smoke`
 * is still populated by `resolveCell` for back-compat with consumers that
 * read it (e.g. tests, but it is intentionally not rendered here).
 */
const DIMENSIONS: Array<{
  key: keyof Omit<CellState, "rollup" | "smoke">;
  label: string;
}> = [
  { key: "d6", label: "Parity (Reference)" },
  { key: "d5", label: "1P (Single Pill)" },
  { key: "d4", label: "BE (Agent)" },
  { key: "e2e", label: "UI (Frontend)" },
  { key: "d2", label: "API (HTTP)" },
  { key: "health", label: "Health" },
];

function formatTimestamp(ts: string | null): string {
  if (!ts) return "n/a";
  return formatTs(ts);
}

/**
 * Keys we extract from the signal object and display as readable
 * key-value pairs rather than raw JSON. Ordered by display priority.
 */
const SIGNAL_DISPLAY_KEYS: ReadonlyArray<{
  key: string;
  label: string;
}> = [
  { key: "errorDesc", label: "Error" },
  { key: "error", label: "Error" },
  { key: "failureSummary", label: "Failure" },
  { key: "backendUrl", label: "Backend URL" },
  { key: "apiRequestCount", label: "API Requests" },
  { key: "step", label: "Step" },
];

/**
 * Extract human-readable fields from a signal object. Returns an array
 * of { label, value } pairs for display. Deduplicates the "Error" label
 * so that `errorDesc` and `error` don't both render when present.
 */
function extractSignalFields(
  signal: unknown,
): Array<{ label: string; value: string }> {
  if (signal == null || typeof signal !== "object" || Array.isArray(signal))
    return [];
  const obj = signal as Record<string, unknown>;
  const fields: Array<{ label: string; value: string }> = [];
  const usedLabels = new Set<string>();
  for (const { key, label } of SIGNAL_DISPLAY_KEYS) {
    if (usedLabels.has(label)) continue;
    const val = obj[key];
    if (val == null) continue;
    // Primitives (string/number/boolean — including the meaningful `0`/`false`)
    // render via String(); a non-null object/array would otherwise stringify to
    // the useless "[object Object]" (or comma-joined garbage), so render it as
    // compact JSON instead.
    let str: string;
    if (typeof val === "object") {
      try {
        str = JSON.stringify(val);
      } catch {
        continue;
      }
    } else {
      str = typeof val === "string" ? val : String(val);
    }
    if (str.length === 0) continue;
    fields.push({ label, value: str });
    usedLabels.add(label);
  }
  return fields;
}

function formatSignal(signal: unknown): string | null {
  if (signal == null) return null;
  if (typeof signal === "string") return signal || null;
  if (typeof signal === "object") {
    if (Array.isArray(signal) && signal.length === 0) return null;
    if (!Array.isArray(signal) && Object.keys(signal as object).length === 0)
      return null;
    try {
      return JSON.stringify(signal, null, 2);
    } catch {
      return null;
    }
  }
  return String(signal) || null;
}

/**
 * Lazy-fetch state for the `signal` blobs the drilldown needs.
 *
 * Phase 0 dropped `signal` from the INITIAL status fetch projection
 * (`STATUS_LIST_FIELDS` in `lib/live-status.ts`) — it is ~61% of the payload
 * by size and only ever read here in the drilldown + the per-cell banner. So
 * rows in the live grid no longer carry `signal`; the drilldown lazy-loads it
 * on demand for exactly the failing badges that surface failure metadata.
 *
 *   - `byId`         — record id → fetched signal blob (empty until the fetch
 *                      lands). An id that was requested but is ABSENT from
 *                      `byId` after the fetch settled is a partial failure (the
 *                      record was e.g. deleted server-side between the grid
 *                      fetch and the drilldown open).
 *   - `requestedIds` — the exact set of ids this fetch targeted. Lets a caller
 *                      resolve per-id state (in-flight / resolved / absent)
 *                      rather than relying on the shared `loading`/`error`.
 *   - `loading`      — `true` while the targeted PB read is in flight.
 *   - `settled`      — `true` once the read resolved OR rejected (i.e. no
 *                      longer in flight). Distinguishes "still loading" from
 *                      "settled but this id never came back".
 *   - `error`        — non-null if the whole fetch failed; the panel degrades
 *                      gracefully (renders without the lazy fields) rather than
 *                      crashing.
 *
 * Per-badge loading/error is derived from these by `resolveBadgeSignalState`:
 * the shared `loading`/`error` flags alone are wrong per-badge — a whole-fetch
 * error would otherwise paint EVERY signal-less failing badge as failed, and a
 * partial result (settled, no error, but an id missing from `byId`) would
 * render NOTHING for that badge (no signal, no "couldn't load"), making the
 * partial failure invisible.
 */
interface LazySignalState {
  byId: Record<string, unknown>;
  requestedIds: ReadonlySet<string>;
  loading: boolean;
  settled: boolean;
  error: string | null;
}

/**
 * Lazy-load the `signal` field for a set of record ids via a single targeted
 * PocketBase `getList`, projecting ONLY `id,signal` and filtering to exactly
 * the ids the drilldown's failing badges reference. `signal` is dropped from
 * the bulk initial fetch (it is the dominant transfer-size cost), so the
 * drilldown fetches just the records it actually renders.
 *
 * `requestKey: null` DISABLES the PB SDK's same-path auto-cancellation: every
 * `getList` against `/api/collections/status/records` derives the same default
 * request key, so a drilldown fetch could cancel (or be cancelled by) the
 * hook's concurrent heartbeat / initial-fetch reads on the shared singleton
 * client. Opting out per-request lets all concurrent same-path reads complete
 * (mirrors `useLiveStatus`'s `fetchInitial`/`heartbeat`).
 */
function useLazySignals(ids: readonly string[]): LazySignalState {
  // Stable key so the effect only re-fires when the *set* of ids changes, not
  // on every render (the array identity from the caller's useMemo is already
  // stable, but this guards against an inadvertent inline array too).
  const idKey = ids.join(",");
  const [state, setState] = useState<LazySignalState>({
    byId: {},
    requestedIds: new Set(ids),
    loading: ids.length > 0,
    settled: ids.length === 0,
    error: null,
  });

  useEffect(() => {
    const requestedIds = new Set(ids);
    if (ids.length === 0) {
      setState({
        byId: {},
        requestedIds,
        loading: false,
        settled: true,
        error: null,
      });
      return;
    }
    let alive = true;
    setState({
      byId: {},
      requestedIds,
      loading: true,
      settled: false,
      error: null,
    });
    const pb = getPb();
    // Build an OR filter over the exact record ids. `pb.filter()` quotes/
    // escapes each value via placeholder so an id is never interpolated raw.
    const clauses = ids.map((_, i) => `id = {:id${i}}`).join(" || ");
    const params: Record<string, string> = {};
    ids.forEach((id, i) => {
      params[`id${i}`] = id;
    });
    const filter = pb.filter(clauses, params);
    pb.collection("status")
      // Page size === `ids.length` is correct ONLY because `id` is the PK: the
      // OR filter matches at most one row per id, so the result can never
      // exceed `ids.length` rows. If this ever filters by a NON-unique key
      // (where one key can match multiple rows), this page size would silently
      // clip rows — bump to a safe ceiling or paginate instead.
      .getList<{ id: string; signal: unknown }>(1, ids.length, {
        filter,
        fields: "id,signal",
        // See the doc comment: disable the SDK's same-path auto-cancellation
        // so this read can't fight the hook's concurrent status reads.
        requestKey: null,
      })
      .then((res) => {
        if (!alive) return;
        const byId: Record<string, unknown> = {};
        for (const item of res.items) {
          byId[item.id] = item.signal;
        }
        setState({
          byId,
          requestedIds,
          loading: false,
          settled: true,
          error: null,
        });
      })
      .catch((err: unknown) => {
        if (!alive) return;
        // Degrade gracefully: the panel still renders its non-signal metadata
        // (fail_count, first_failure_at, dimension labels). We surface the
        // error inline so operators know the detail couldn't be loaded rather
        // than silently showing an empty failure.
        setState({
          byId: {},
          requestedIds,
          loading: false,
          settled: true,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    return () => {
      alive = false;
    };
    // `idKey` is the stable dependency; `ids` itself is intentionally derived
    // from it. Re-running on a changed id SET is exactly the desired behaviour.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idKey]);

  return state;
}

/**
 * Resolve the per-badge lazy-signal `loading`/`error` flags from the SHARED
 * batched-fetch state. The single `lazy.loading`/`lazy.error` is wrong
 * per-badge: it would paint EVERY signal-less failing badge with the same flag
 * even though the batched fetch's outcome is not badge-specific, and it would
 * miss a PARTIAL failure entirely. We instead derive each badge's state from
 * whether THIS badge's record id was requested and whether it came back:
 *
 *   - id absent from `requestedIds`      → this badge wasn't lazy-fetched (its
 *                                          row already carried a signal, or it
 *                                          isn't a signal-less failure) → no
 *                                          loading, no error.
 *   - still in flight (`!settled`)       → loading.
 *   - settled AND (whole fetch errored
 *     OR this id is absent from `byId`)  → error. The absent-from-`byId` case
 *                                          is the partial failure: the id was
 *                                          requested but the record didn't come
 *                                          back (e.g. deleted server-side),
 *                                          which would otherwise render nothing.
 *   - settled AND present in `byId`      → resolved → neither.
 */
function resolveBadgeSignalState(
  rowId: string | undefined,
  lazy: LazySignalState,
): { loading: boolean; error: string | null } {
  if (rowId === undefined || !lazy.requestedIds.has(rowId)) {
    return { loading: false, error: null };
  }
  if (!lazy.settled) {
    return { loading: true, error: null };
  }
  // Settled. A resolved id is present in `byId`; an absent one is a partial
  // failure even when the overall fetch didn't error.
  const present = Object.prototype.hasOwnProperty.call(lazy.byId, rowId);
  if (lazy.error !== null) {
    return { loading: false, error: lazy.error };
  }
  if (!present) {
    return { loading: false, error: "signal record not found" };
  }
  return { loading: false, error: null };
}

/**
 * Distinguish a GENUINE failure badge (which has — or should have — a failure
 * `signal` worth lazy-fetching and surfacing) from a mere STALENESS DOWNGRADE.
 *
 * `buildBadge` (lib/live-status.ts) downgrades a passing GREEN row whose
 * `observed_at` aged past its staleness window to `degraded`/amber. That amber
 * badge's underlying row passed green — it has `fail_count === 0`, no failure
 * `signal` server-side — its only issue is staleness, not failure. Treating it
 * as a failure (collecting its id for a lazy signal fetch) makes the drilldown
 * fetch a record that has no failure signal, `resolveBadgeSignalState` returns
 * "signal record not found", and a spurious "Couldn't load failure details"
 * affordance renders for a cell that never failed.
 *
 * A genuine failure is therefore:
 *   - a RED badge (a real failure regardless of fail_count), OR
 *   - an AMBER badge whose row recorded at least one failure (`fail_count > 0`)
 *     — a producer-emitted `degraded` state, NOT a stale-green downgrade.
 *
 * A stale-green downgrade (amber tone, `fail_count === 0`) is excluded: no
 * fetch, no error affordance. `fail_count` is the discriminator because the
 * downgrade only rewrites `.state` (green→degraded) and preserves the original
 * `fail_count` of 0, whereas a producer-degraded row carries `fail_count > 0`.
 */
function isGenuineFailure(badge: BadgeRender): boolean {
  if (badge.tone === "red") return true;
  if (badge.tone === "amber") return (badge.row?.fail_count ?? 0) > 0;
  return false;
}

/**
 * Compact relative-time formatter for the §7.2 family annotation line
 * ("3h ago"). Local to the drilldown — the annotation is the only consumer;
 * everything else in this panel renders absolute timestamps via `formatTs`.
 */
function relativeTime(iso: string, nowMs: number): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "unknown";
  const minutes = Math.floor(Math.max(0, nowMs - t) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * §7.2 family staleness annotation, appended to a badge row when — and only
 * when — BOTH hold:
 *
 *   1. The badge is STALE-degraded by the cell's EXISTING stale check
 *      (whichever window its dimension already applies — `E2E_STALE_AFTER_MS`
 *      for d5/d6/e2e rows, `D4_STALE_AFTER_MS` for d4/e2e-smoke rows). The
 *      amber + `fail_count === 0` shape is that downgrade's signature (the
 *      complement of `isGenuineFailure`'s amber arm: a producer-degraded row
 *      carries `fail_count > 0`). This helper applies NO threshold of its
 *      own — it piggybacks the verdict, never substitutes a different one.
 *   2. The row's probe-key prefix maps to a worker family via the
 *      `probeKeyPrefix` each `/api/runs` entry echoes (§5.2.1) — payload-
 *      driven through `familyForProbeKey`, never a dashboard-side prefix
 *      table.
 *
 * The line answers WHY the cell is degraded: "Family last succeeded
 * <relative> · last attempt <relative> (<outcome>)". Last attempt is
 * inflight-aware (a present inflight batch is the newest attempt — rendered
 * `stalled` when the server marked it stalled, else `running`); otherwise the
 * server's `lastRun.outcome` is rendered VERBATIM (no client
 * re-classification). Null `lastSuccessAt` renders "never" (the §5.2.1
 * never-succeeded case); a zero-batch family has nothing to attribute and
 * yields no annotation. Exported for direct unit-testing of key shapes
 * (e.g. d4 rows) that `resolveCell` doesn't surface in this panel today.
 */
export function familyStalenessAnnotation(
  badge: BadgeRender,
  families: WorkerFamilySummary[],
  nowMs: number,
): string | null {
  const row = badge.row;
  if (badge.tone !== "amber" || row === null || row.fail_count > 0) {
    return null;
  }
  const family = familyForProbeKey(row.key, families);
  // A degraded entry (`error: "history_unavailable"`) carries no run data —
  // §6.1 surfaces that as the unavailable incident class, not here.
  if (family === undefined || family.error !== undefined) return null;
  const lastAttempt = family.inflight
    ? {
        at: family.inflight.enqueuedAt,
        outcome: family.inflight.stalled ? "stalled" : "running",
      }
    : family.lastRun
      ? {
          at: family.lastRun.finishedAt ?? family.lastRun.enqueuedAt,
          outcome: family.lastRun.outcome,
        }
      : null;
  if (lastAttempt === null) return null;
  const succeeded =
    family.lastSuccessAt != null
      ? relativeTime(family.lastSuccessAt, nowMs)
      : "never";
  return `Family last succeeded ${succeeded} · last attempt ${relativeTime(
    lastAttempt.at,
    nowMs,
  )} (${lastAttempt.outcome})`;
}

function CollapsibleSignal({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1">
      <button
        type="button"
        data-testid="signal-toggle"
        onClick={() => setOpen(!open)}
        className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text)] cursor-pointer flex items-center gap-1"
      >
        <span className="text-[9px]">{open ? "▼" : "▶"}</span>
        Raw Signal
      </button>
      {open && (
        <pre
          data-testid="signal-payload"
          className="mt-1 p-2 rounded bg-[var(--bg-muted)] text-[10px] text-[var(--text)] overflow-x-auto max-h-40 whitespace-pre-wrap break-all"
        >
          {text}
        </pre>
      )}
    </div>
  );
}

function BadgeRow({
  badge,
  label,
  lazySignal,
  signalLoading,
  signalError,
}: {
  badge: BadgeRender;
  label: string;
  /**
   * Lazily-fetched `signal` for this badge's row, when the row arrived without
   * one (the initial fetch projection drops `signal`). When the row already
   * carries a `signal`, that wins — the lazy value is only a fallback so an
   * SSE delta (which DOES include `signal`) is never overridden by a stale
   * lazy read.
   */
  lazySignal?: unknown;
  /** `true` while the lazy signal fetch is in flight. */
  signalLoading?: boolean;
  /** Non-null when the lazy signal fetch failed. */
  signalError?: string | null;
}) {
  const isFailure = isGenuineFailure(badge);
  // §7.2: worker-runs context for the family staleness annotation. The T10
  // no-provider contract guarantees `useWorkerRuns()` never throws and
  // returns the no-data default (`null`) absent a provider — provider-less
  // renders simply skip the annotation.
  const workerRuns = useWorkerRuns();
  const families =
    workerRuns !== null && workerRuns.status === "ok"
      ? workerRuns.data.families
      : null;
  const annotation =
    families !== null
      ? familyStalenessAnnotation(badge, families, Date.now())
      : null;
  // Prefer the row's own signal (an SSE delta delivers full rows); fall back to
  // the lazily-fetched one when the projected initial row had none.
  const rowSignal = badge.row?.signal;
  const effectiveSignal =
    rowSignal != null && rowSignal !== "" ? rowSignal : lazySignal;
  const signalText = badge.row ? formatSignal(effectiveSignal) : null;
  const signalFields = badge.row ? extractSignalFields(effectiveSignal) : [];
  // Only show the lazy loading/error affordances when this badge is a failure
  // AND it still lacks any resolved signal to display.
  const showLoading =
    isFailure && !!badge.row && !!signalLoading && signalFields.length === 0;
  const showError =
    isFailure &&
    !!badge.row &&
    !signalLoading &&
    !!signalError &&
    signalFields.length === 0 &&
    !signalText;

  return (
    <div
      data-testid={`drilldown-badge-${label.toLowerCase().replace(/[^a-z0-9]/g, "-")}`}
      className="py-2 border-b border-[var(--border)] last:border-b-0"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className={`inline-block w-2 h-2 rounded-full ${DOT_BG[badge.tone]}`}
          />
          <span className="text-xs font-medium text-[var(--text)]">
            {label}
          </span>
        </div>
        {badge.label === "?" ? (
          <span className="text-xs text-[var(--text-muted)] line-through">
            n/a
          </span>
        ) : (
          <span
            className={`text-xs font-semibold tabular-nums ${TONE_CLASS[badge.tone]}`}
          >
            {badge.label}
          </span>
        )}
      </div>
      {isFailure && badge.row && (
        <div className="mt-1.5 pl-4 space-y-1">
          {/* Lazy-signal loading placeholder — shown while the targeted
              PocketBase read for this record's `signal` is in flight. */}
          {showLoading && (
            <div
              data-testid="signal-loading"
              className="flex items-center gap-1.5 text-[10px] text-[var(--text-muted)]"
            >
              <span
                className="inline-block w-2.5 h-2.5 rounded-full border border-current border-t-transparent animate-spin"
                aria-hidden="true"
              />
              Loading details…
            </div>
          )}
          {/* Lazy-signal error — degrade gracefully (the non-signal metadata
              below still renders) but tell the operator detail load failed. */}
          {showError && (
            <div
              data-testid="signal-error"
              className="text-[10px] text-[var(--text-muted)]"
            >
              Couldn&apos;t load failure details
            </div>
          )}
          {/* Extracted signal fields — readable key-value pairs */}
          {signalFields.length > 0 && (
            <div className="space-y-0.5">
              {signalFields.map(({ label: fieldLabel, value }) => (
                <div key={fieldLabel} className="text-xs">
                  <span className="text-[var(--text-muted)]">
                    {fieldLabel}:
                  </span>{" "}
                  <span
                    data-testid={`signal-field-${fieldLabel.toLowerCase().replace(/\s+/g, "-")}`}
                    className={`font-medium ${badge.tone === "red" ? "text-[var(--danger)]" : "text-[var(--amber)]"}`}
                  >
                    {value}
                  </span>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center gap-3 text-[10px] text-[var(--text-muted)]">
            {badge.row.fail_count > 0 && (
              <span>
                Failures:{" "}
                <span
                  data-testid="fail-count"
                  className="text-[var(--danger)] font-semibold tabular-nums"
                >
                  {badge.row.fail_count}
                </span>
              </span>
            )}
            {badge.row.first_failure_at && (
              <span>
                Since{" "}
                <span
                  data-testid="first-failure"
                  className="text-[var(--text)]"
                >
                  {formatTimestamp(badge.row.first_failure_at)}
                </span>
              </span>
            )}
          </div>
          {/* Raw signal — collapsible for debugging */}
          {signalText && <CollapsibleSignal text={signalText} />}
        </div>
      )}
      {/* §7.2 family staleness annotation: only for STALE-degraded rows whose
          probe-key prefix maps to a worker family (payload probeKeyPrefix).
          Turns "amber, shrug" into "amber because the family hasn't completed
          a run since <time> — last attempt <outcome>". */}
      {annotation !== null && (
        <div
          data-testid="family-annotation"
          className="mt-1 pl-4 text-[10px] text-[var(--amber)]"
        >
          {annotation}
        </div>
      )}
    </div>
  );
}

export function CellDrilldown({
  slug,
  featureId,
  integrationName,
  featureName,
  liveStatus,
  connection = "live",
  onClose,
}: CellDrilldownProps) {
  // `resolveCell` is unmemoized and returns a fresh object every call, so we
  // memoize it here on its actual inputs. Without this the `idsNeedingSignal`
  // memo below (keyed on `cell`) would recompute every render and provide no
  // stabilization — the real fetch gate is `idKey` inside `useLazySignals`,
  // but memoizing `cell` makes the downstream memo genuinely effective.
  const cell = useMemo(
    () => resolveCell(liveStatus, slug, featureId, { connection }),
    [liveStatus, slug, featureId, connection],
  );

  // Collect the record ids of GENUINELY-FAILING badges whose row arrived
  // WITHOUT a `signal` (the initial fetch projection drops it — see
  // STATUS_LIST_FIELDS). Those are the only records the drilldown needs to
  // lazy-load detail for; a green/no-data badge surfaces no failure metadata so
  // it needs no signal, a STALE-GREEN downgrade (amber, fail_count 0 — see
  // isGenuineFailure) is excluded because it has no failure signal server-side,
  // and a row that already carries a `signal` (e.g. delivered by an SSE delta)
  // is used as-is. With `cell` memoized above, this only re-fires when the set
  // of ids actually changes.
  const idsNeedingSignal = useMemo(() => {
    const ids: string[] = [];
    for (const dim of DIMENSIONS) {
      const badge = cell[dim.key];
      // Only GENUINE failures need a lazy signal fetch. A stale-green downgrade
      // (amber, fail_count 0) is excluded — see isGenuineFailure: fetching it
      // would surface a spurious "couldn't load failure details" for a cell
      // whose only issue is staleness, not failure.
      const isFailure = isGenuineFailure(badge);
      if (!isFailure || !badge.row) continue;
      const sig = badge.row.signal;
      const hasSignal = sig != null && sig !== "";
      if (!hasSignal) ids.push(badge.row.id);
    }
    // Dedupe + stable order so the fetch key is deterministic.
    return Array.from(new Set(ids)).sort();
  }, [cell]);

  const lazy = useLazySignals(idsNeedingSignal);

  return (
    <div
      data-testid="cell-drilldown"
      className="absolute z-50 mt-1 w-[480px] rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] shadow-lg"
      role="dialog"
      aria-label={`${integrationName} / ${featureName} detail`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--border)] bg-[var(--bg-muted)] rounded-t-lg">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-[var(--text)] truncate">
            {integrationName}
          </div>
          <div className="text-xs text-[var(--text-muted)] truncate">
            {featureName}
          </div>
        </div>
        <button
          type="button"
          data-testid="drilldown-close"
          onClick={onClose}
          className="ml-2 p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] text-sm leading-none cursor-pointer"
          aria-label="Close"
        >
          x
        </button>
      </div>
      {/* Rollup */}
      <div className="px-4 py-2 flex items-center gap-2 border-b border-[var(--border)]">
        <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">
          Service (health + e2e)
        </span>
        <span
          className={`inline-block w-2 h-2 rounded-full ${DOT_BG[cell.rollup]}`}
        />
        <span className={`text-xs font-semibold ${TONE_CLASS[cell.rollup]}`}>
          {cell.rollup}
        </span>
      </div>
      {/* Badge rows */}
      <div className="px-4 py-1">
        {DIMENSIONS.map((dim) => {
          const badge = cell[dim.key];
          const rowId = badge.row?.id;
          // Derive this badge's loading/error PER-ID from the shared batched
          // fetch state — the single `lazy.loading`/`lazy.error` is wrong
          // per-badge (whole-fetch error would paint every badge; a partial
          // result would silently render nothing). See resolveBadgeSignalState.
          const { loading: signalLoading, error: signalError } =
            resolveBadgeSignalState(rowId, lazy);
          return (
            <BadgeRow
              key={dim.key}
              badge={badge}
              label={dim.label}
              lazySignal={rowId ? lazy.byId[rowId] : undefined}
              signalLoading={signalLoading}
              signalError={signalError}
            />
          );
        })}
      </div>
    </div>
  );
}
