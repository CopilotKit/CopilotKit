"use client";
/**
 * StatusDetailPanel — probe drilldown shown when the operator selects a row
 * in the Status table. Composes the recent-runs list and a small inline
 * duration sparkline. Polls the per-probe endpoint via `useProbeDetail`.
 *
 * Keeps presentation minimal — header + two sections — to stay out of the
 * way when the operator just wants a quick look at the last 10 runs.
 *
 * When `probeId` is null the panel returns null so the parent doesn't have
 * to gate rendering itself.
 */
import { useProbeDetail } from "../hooks/use-probes";
import { StatusRunsList } from "./status-runs-list";
import { StatusDurationSparkline } from "./status-duration-sparkline";

export interface StatusDetailPanelProps {
  probeId: string | null;
  onClose: () => void;
}

export function StatusDetailPanel({
  probeId,
  onClose,
}: StatusDetailPanelProps) {
  // Always call the hook before any early return — otherwise the call
  // ordering depends on `probeId` and React will throw. The hook itself
  // short-circuits when given null.
  const { data, error, loading } = useProbeDetail(probeId);

  if (probeId === null) return null;

  // Sparkline reads oldest → newest. The API returns runs newest-first,
  // so we reverse and drop runs that haven't recorded a duration yet.
  const durations = data
    ? [...data.runs]
        .reverse()
        .map((r) => r.durationMs)
        .filter((d): d is number => typeof d === "number")
    : [];

  return (
    <div
      data-testid="status-detail-panel"
      className="px-8 py-4 border-t border-[var(--border)] flex flex-col gap-4"
    >
      <div
        data-testid="status-detail-header"
        className="flex items-center justify-between"
      >
        <div className="text-sm font-mono text-[var(--text-secondary)]">
          {probeId}
        </div>
        <button
          type="button"
          data-testid="status-detail-close"
          onClick={onClose}
          className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] px-2 py-1 rounded border border-[var(--border)]"
          aria-label="Close probe detail"
        >
          Close
        </button>
      </div>

      {loading && !data && (
        <div
          data-testid="status-detail-loading"
          className="text-xs text-[var(--text-muted)]"
        >
          Loading…
        </div>
      )}

      {error && (
        <div
          data-testid="status-detail-error"
          className="text-xs text-[var(--danger)]"
        >
          Failed to load probe detail: {error.message}
        </div>
      )}

      {data && (
        <>
          <section data-testid="status-detail-runs" className="flex flex-col gap-2">
            <h3 className="text-xs uppercase tracking-wide text-[var(--text-muted)]">
              Recent Runs
            </h3>
            <StatusRunsList runs={data.runs} />
          </section>

          <section
            data-testid="status-detail-trend"
            className="flex flex-col gap-2"
          >
            <h3 className="text-xs uppercase tracking-wide text-[var(--text-muted)]">
              Duration Trend
            </h3>
            <StatusDurationSparkline durations={durations} />
          </section>
        </>
      )}
    </div>
  );
}
