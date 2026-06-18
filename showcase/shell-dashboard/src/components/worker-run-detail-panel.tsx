"use client";
/**
 * WorkerRunDetailPanel — run-history drill-down for one worker family
 * (spec §6.2), opened when the operator clicks a worker-runs-table row.
 * Same slide-in composition as StatusDetailPanel: header + close, then
 * the history list (last 20 batches via `GET /api/runs/:family`, rows
 * styled like status-runs-list), each batch expandable to the
 * per-service job table (`GET /api/runs/:family/:runId`).
 *
 * Failure posture (§6.1/§6.3, panel-LOCAL — this panel never touches
 * the section's unavailable state):
 *   - `429`/ThrottledError from either drill-down route is explicitly
 *     NON-incident: the CP is alive and deliberately throttling. The
 *     fetchers already honor Retry-After with a capped internal retry;
 *     when they exhaust, the panel renders a transient "throttled —
 *     retrying…" hint with a manual retry affordance — never the
 *     unreachable treatment.
 *   - a response carrying `error: "history_unavailable"` (PB down while
 *     the CP answers) renders the panel-local red error line.
 *   - `truncated: true` batches (§5.2.2 degenerate clamp) render an
 *     honest-partial marker: every count may undercount.
 *
 * Cursor paging is strictly §5.2.2: `nextBefore`/`nextBeforeId` echoed
 * back verbatim as a composite pair — never `before` alone.
 */
import { Fragment, useCallback, useEffect, useRef, useState } from "react";

import { formatDuration, formatRelative } from "./status-table";
import { OutcomeChip } from "./worker-runs-table";
import {
  fetchWorkerRunDetail,
  fetchWorkerRunHistory,
  ThrottledError,
  type WorkerRunBatch,
  type WorkerRunJob,
  type WorkerRunsCursor,
} from "../lib/ops-api";

export interface WorkerRunDetailPanelProps {
  /** Family id, or null = panel closed (renders nothing). */
  family: string | null;
  onClose: () => void;
}

/** Per-batch drill-down (jobs) load state. */
type JobsState =
  | { state: "loading" }
  | { state: "ok"; jobs: WorkerRunJob[] }
  | { state: "throttled" }
  | { state: "error"; message: string };

/** History list load state — `throttled` is the §6.1 non-incident path. */
type HistoryState =
  | { state: "loading" }
  | { state: "ok" }
  | { state: "throttled" }
  | { state: "error"; message: string };

function useNowTick(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/**
 * §6.2/§6.3 comm-error kind badge. `worker-reclaimed-pending` is the
 * NEUTRAL reclaim taxonomy value (contracts.ts) — gray "re-queued",
 * never red — while every terminal kind gets the same indigo
 * "unreachable" treatment the matrix's comm-error overlay uses
 * (`FleetSurfaceState` in live-status.ts / depth-chip's ⚡ branch).
 * The kind is enum-validated server-side (closed vocabulary; unknown
 * values arrive as "unknown") — safe to render verbatim.
 */
export function CommErrorKindBadge({ kind }: { kind: string }) {
  if (kind === "worker-reclaimed-pending") {
    return (
      <span
        data-testid="comm-kind-badge"
        data-kind={kind}
        data-treatment="pending"
        className="inline-flex items-center gap-1 rounded border border-[var(--text-muted)]/40 bg-[var(--text-muted)]/20 px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]"
        title={kind}
      >
        ⟳ re-queued
      </span>
    );
  }
  return (
    <span
      data-testid="comm-kind-badge"
      data-kind={kind}
      data-treatment="unreachable"
      className="inline-flex items-center gap-1 rounded border border-indigo-400/60 bg-indigo-500/20 px-1.5 py-0.5 text-[10px] text-indigo-300"
      title={kind}
    >
      ⚡ {kind}
    </span>
  );
}

/** Per-service job table for one expanded batch (§5.2.3 shape). */
function JobsTable({ jobs }: { jobs: WorkerRunJob[] }) {
  return (
    <table className="w-full text-sm border-collapse">
      <thead>
        <tr className="text-left text-xs uppercase tracking-wide text-[var(--text-muted)] border-b border-[var(--border)]">
          <th className="py-1.5 pr-4">Service</th>
          <th className="py-1.5 pr-4">Worker</th>
          <th className="py-1.5 pr-4">Queue latency</th>
          <th className="py-1.5 pr-4">Duration</th>
          <th className="py-1.5 pr-4">Outcome</th>
          <th className="py-1.5">Error</th>
        </tr>
      </thead>
      <tbody>
        {jobs.map((job) => (
          <tr
            key={job.jobId}
            data-testid={`worker-run-job-${job.jobId}`}
            className="border-b border-[var(--border)]"
          >
            <td className="py-1.5 pr-4 text-xs font-mono">{job.serviceSlug}</td>
            <td className="py-1.5 pr-4 text-xs font-mono">
              {job.claimedBy ?? "—"}
            </td>
            <td className="py-1.5 pr-4 text-xs tabular-nums">
              {job.queueLatencyMs != null
                ? formatDuration(job.queueLatencyMs)
                : "—"}
            </td>
            <td className="py-1.5 pr-4 text-xs tabular-nums">
              {job.durationMs != null ? formatDuration(job.durationMs) : "—"}
            </td>
            <td className="py-1.5 pr-4 text-xs" data-status={job.status}>
              {job.status}
              {job.reclaimCount > 0 ? (
                <span
                  className="ml-1 text-[10px] text-[var(--text-muted)]"
                  title="hook-stamped reclaim count (§4.2)"
                >
                  ×{job.reclaimCount} reclaimed
                </span>
              ) : null}
            </td>
            <td className="py-1.5 text-xs">
              <span className="flex items-center gap-1.5 flex-wrap">
                {job.errorSummary ? (
                  <span className="text-[var(--danger)]">
                    {job.errorSummary}
                  </span>
                ) : null}
                {job.commError ? (
                  <CommErrorKindBadge kind={job.commError.kind} />
                ) : null}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function WorkerRunDetailPanel({
  family,
  onClose,
}: WorkerRunDetailPanelProps) {
  const now = useNowTick();
  const [batches, setBatches] = useState<WorkerRunBatch[]>([]);
  const [cursor, setCursor] = useState<WorkerRunsCursor | null>(null);
  const [history, setHistory] = useState<HistoryState>({ state: "loading" });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [jobsByRun, setJobsByRun] = useState<Record<string, JobsState>>({});
  // Bumping this re-runs the load effect from scratch — the manual retry
  // affordance for the throttled/error states.
  const [reloadKey, setReloadKey] = useState(0);
  // Shared abort controller covering BOTH the first-page effect and any
  // in-flight `loadMore` page-N fetch: cancelled together on cleanup
  // (panel close / family change / unmount) so stale rows never append.
  const loadAbortRef = useRef<AbortController | null>(null);
  // Dedupe drill-down fetches without doing async work inside a setState
  // updater. Under React StrictMode the updater is invoked twice; gating
  // on a ref (not on the state snapshot the updater receives) means the
  // network call fires exactly once regardless.
  const jobsRequestedRef = useRef<Set<string>>(new Set());

  // First page load (and full reset) whenever the family changes.
  useEffect(() => {
    if (family === null) return;
    let cancelled = false;
    const controller = new AbortController();
    loadAbortRef.current = controller;
    setBatches([]);
    setCursor(null);
    setExpanded(new Set());
    setJobsByRun({});
    jobsRequestedRef.current = new Set();
    setHistory({ state: "loading" });
    (async () => {
      try {
        const res = await fetchWorkerRunHistory(family, undefined, {
          signal: controller.signal,
        });
        if (cancelled) return;
        if (res.error === "history_unavailable") {
          setHistory({
            state: "error",
            message: "run history backend unreachable",
          });
          return;
        }
        setBatches(res.runs);
        setCursor(
          res.nextBefore !== null && res.nextBeforeId !== null
            ? { before: res.nextBefore, beforeId: res.nextBeforeId }
            : null,
        );
        setHistory({ state: "ok" });
      } catch (err) {
        if (cancelled) return;
        if ((err as { name?: string })?.name === "AbortError") return;
        if (err instanceof ThrottledError) {
          setHistory({ state: "throttled" });
          return;
        }
        setHistory({
          state: "error",
          message: (err as Error)?.message ?? "unknown error",
        });
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
      if (loadAbortRef.current === controller) {
        loadAbortRef.current = null;
      }
    };
  }, [family, reloadKey]);

  const loadMore = useCallback(async () => {
    if (family === null || cursor === null) return;
    // Share the cleanup-triggered AbortController with the first-page
    // effect so a pending page-2 fetch is cancelled on panel close or
    // family change — preventing stale rows from appending.
    const controller = loadAbortRef.current ?? new AbortController();
    if (loadAbortRef.current === null) loadAbortRef.current = controller;
    try {
      const res = await fetchWorkerRunHistory(family, cursor, {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (res.error === "history_unavailable") {
        setHistory({
          state: "error",
          message: "run history backend unreachable",
        });
        return;
      }
      setBatches((prev) => [...prev, ...res.runs]);
      setCursor(
        res.nextBefore !== null && res.nextBeforeId !== null
          ? { before: res.nextBefore, beforeId: res.nextBeforeId }
          : null,
      );
    } catch (err) {
      if (controller.signal.aborted) return;
      if ((err as { name?: string })?.name === "AbortError") return;
      if (err instanceof ThrottledError) {
        setHistory({ state: "throttled" });
        return;
      }
      setHistory({
        state: "error",
        message: (err as Error)?.message ?? "unknown error",
      });
    }
  }, [family, cursor]);

  const toggleBatch = useCallback(
    (runId: string) => {
      if (family === null) return;
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(runId)) {
          next.delete(runId);
          return next;
        }
        next.add(runId);
        return next;
      });
      // Lazy-load the drill-down once per batch. The dedupe gate is a ref
      // (not the setState snapshot) so StrictMode's double-invoke of any
      // updater can never double-fire the network request. The side-effect
      // happens OUTSIDE setJobsByRun for the same reason: updaters must be
      // pure.
      if (jobsRequestedRef.current.has(runId)) return;
      jobsRequestedRef.current.add(runId);
      setJobsByRun((prev) =>
        prev[runId] ? prev : { ...prev, [runId]: { state: "loading" } },
      );
      void (async () => {
        try {
          const res = await fetchWorkerRunDetail(family, runId);
          if (res.error === "history_unavailable") {
            setJobsByRun((p) => ({
              ...p,
              [runId]: {
                state: "error",
                message: "run history backend unreachable",
              },
            }));
            return;
          }
          setJobsByRun((p) => ({
            ...p,
            [runId]: { state: "ok", jobs: res.jobs },
          }));
        } catch (err) {
          if ((err as { name?: string })?.name === "AbortError") return;
          setJobsByRun((p) => ({
            ...p,
            [runId]:
              err instanceof ThrottledError
                ? { state: "throttled" }
                : {
                    state: "error",
                    message: (err as Error)?.message ?? "unknown error",
                  },
          }));
        }
      })();
    },
    [family],
  );

  if (family === null) return null;

  return (
    <div
      data-testid="worker-run-detail-panel"
      className="px-0 py-4 border-t border-[var(--border)] flex flex-col gap-4"
    >
      <div className="flex items-center justify-between">
        <div className="text-sm font-mono text-[var(--text-secondary)]">
          {family} — run history
        </div>
        <button
          type="button"
          data-testid="worker-run-detail-close"
          onClick={onClose}
          className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] px-2 py-1 rounded border border-[var(--border)]"
          aria-label="Close run history"
        >
          Close
        </button>
      </div>

      {history.state === "loading" && batches.length === 0 && (
        <div className="text-xs text-[var(--text-muted)]">Loading…</div>
      )}

      {/* §6.1: throttling is NON-incident — a transient hint plus a manual
          retry affordance, never the unreachable/error treatment. */}
      {history.state === "throttled" && (
        <div
          data-testid="worker-run-detail-throttled"
          className="text-xs text-[var(--text-muted)] flex items-center gap-2"
        >
          <span>throttled — retrying…</span>
          <button
            type="button"
            data-testid="worker-run-detail-retry"
            onClick={() => setReloadKey((k) => k + 1)}
            className="px-2 py-0.5 rounded border border-[var(--border)] hover:text-[var(--text-primary)]"
          >
            Retry
          </button>
        </div>
      )}

      {history.state === "error" && (
        <div
          data-testid="worker-run-detail-error"
          className="text-xs text-[var(--danger)]"
        >
          Failed to load run history: {history.message}
        </div>
      )}

      {history.state === "ok" && batches.length === 0 && (
        <div className="text-xs text-[var(--text-muted)]">
          No runs recorded.
        </div>
      )}

      {batches.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-[var(--text-muted)] border-b border-[var(--border)]">
                <th className="py-2 pr-4">Started</th>
                <th className="py-2 pr-4">Duration</th>
                <th className="py-2 pr-4">Outcome</th>
                <th className="py-2 pr-4">Triggered</th>
                <th className="py-2 pr-4">Jobs</th>
                <th className="py-2">Reds</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => {
                const startedMs = Date.parse(b.enqueuedAt);
                const isExpanded = expanded.has(b.runId);
                const jobsState = jobsByRun[b.runId];
                const reds =
                  (b.redsIntroduced ?? 0) > 0 || (b.redsCleared ?? 0) > 0
                    ? `+${b.redsIntroduced ?? 0} / −${b.redsCleared ?? 0}`
                    : null;
                return (
                  <Fragment key={b.runId}>
                    <tr
                      data-testid={`worker-run-batch-${b.runId}`}
                      onClick={() => toggleBatch(b.runId)}
                      className="border-b border-[var(--border)] hover:bg-[var(--surface-hover)] cursor-pointer"
                    >
                      <td className="py-2 pr-4 text-xs tabular-nums">
                        <span
                          className="inline-block mr-1.5 text-[10px] text-[var(--text-muted)] transition-transform"
                          style={{
                            transform: isExpanded
                              ? "rotate(90deg)"
                              : "rotate(0deg)",
                          }}
                        >
                          ▶
                        </span>
                        {Number.isFinite(startedMs)
                          ? formatRelative(startedMs, now)
                          : b.enqueuedAt}
                        {b.truncated ? (
                          <span
                            data-testid={`worker-run-batch-${b.runId}-truncated`}
                            className="ml-1.5 inline-block rounded border border-[var(--amber)] px-1 py-0.5 text-[10px] text-[var(--amber)]"
                            title="batch larger than the capped fetch window — every count may undercount (§5.2.2)"
                          >
                            partial
                          </span>
                        ) : null}
                      </td>
                      <td className="py-2 pr-4 text-xs tabular-nums">
                        {b.durationMs != null
                          ? formatDuration(b.durationMs)
                          : "—"}
                      </td>
                      <td className="py-2 pr-4 text-xs">
                        <OutcomeChip
                          outcome={b.outcome}
                          commErrorKinds={b.commErrorKinds}
                          testId={`worker-run-batch-${b.runId}-outcome`}
                        />
                      </td>
                      <td className="py-2 pr-4 text-xs">
                        {b.triggered ? (
                          <span className="inline-block rounded border border-[var(--border)] px-1.5 py-0.5 text-[11px] text-[var(--text-secondary)]">
                            manual
                          </span>
                        ) : null}
                      </td>
                      <td className="py-2 pr-4 text-xs tabular-nums">
                        {b.jobs.done}/{b.jobs.total}
                        {b.jobs.failed > 0 ? ` (${b.jobs.failed} fail)` : ""}
                        {b.jobs.reclaimed > 0
                          ? ` (${b.jobs.reclaimed} reclaimed)`
                          : ""}
                      </td>
                      <td className="py-2 text-xs tabular-nums">{reds}</td>
                    </tr>
                    {isExpanded && (
                      <tr className="border-b border-[var(--border)]">
                        <td
                          colSpan={6}
                          className="py-2 px-4"
                          data-testid={`worker-run-jobs-${b.runId}`}
                        >
                          {!jobsState || jobsState.state === "loading" ? (
                            <div className="text-xs text-[var(--text-muted)]">
                              Loading…
                            </div>
                          ) : jobsState.state === "throttled" ? (
                            <div
                              data-testid="worker-run-detail-throttled"
                              className="text-xs text-[var(--text-muted)]"
                            >
                              throttled — retrying…
                            </div>
                          ) : jobsState.state === "error" ? (
                            <div
                              data-testid="worker-run-detail-error"
                              className="text-xs text-[var(--danger)]"
                            >
                              Failed to load run detail: {jobsState.message}
                            </div>
                          ) : (
                            <JobsTable jobs={jobsState.jobs} />
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {cursor !== null && history.state === "ok" && (
        <button
          type="button"
          data-testid="worker-run-detail-load-more"
          onClick={() => void loadMore()}
          className="self-start text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] px-2 py-1 rounded border border-[var(--border)]"
        >
          Load older runs
        </button>
      )}
    </div>
  );
}
