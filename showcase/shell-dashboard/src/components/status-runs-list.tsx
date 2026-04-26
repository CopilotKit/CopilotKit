"use client";
/**
 * StatusRunsList — recent-runs table inside the probe-detail panel.
 *
 * Columns: Started (relative) | Duration | State | Triggered | Summary.
 *
 * Tone of the State badge:
 *   - "running" — finishedAt is null (in-flight)
 *   - "red"     — summary.failed > 0 (any test failed) — represents a "failed" run
 *   - "green"   — finished and no failures — represents a "completed" run
 *
 * Reuses `formatDuration` and `formatRelative` from status-table so the
 * dashboard's time/duration formatting stays consistent across views.
 */
import { useEffect, useState } from "react";
import { formatDuration, formatRelative } from "./status-table";
import type { ProbeRun } from "../lib/ops-api";

export interface StatusRunsListProps {
  runs: ProbeRun[];
}

type StateTone = "green" | "red" | "running" | "gray";

const TONE_CLASS: Record<StateTone, string> = {
  green: "text-[var(--ok)]",
  red: "text-[var(--danger)]",
  running: "text-[var(--accent)]",
  gray: "text-[var(--text-muted)]",
};

function runTone(run: ProbeRun): StateTone {
  if (!run.finishedAt) return "running";
  if (run.summary && run.summary.failed > 0) return "red";
  if (run.summary) return "green";
  // Finished but no summary recorded — treat as gray (unknown) rather
  // than green so we don't mislead the operator about coverage.
  return "gray";
}

function runStateLabel(run: ProbeRun): string {
  if (!run.finishedAt) return "running";
  if (run.summary && run.summary.failed > 0) return "failed";
  // Finished but no summary recorded — match runTone()'s "gray" tone
  // with an "unknown" label so the badge can't say "completed" when
  // we actually have no idea whether the run succeeded.
  if (!run.summary) return "unknown";
  return "completed";
}

function useNowTick(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export function StatusRunsList({ runs }: StatusRunsListProps) {
  const now = useNowTick();

  if (runs.length === 0) {
    return (
      <div
        data-testid="status-runs-empty"
        className="px-2 py-3 text-xs text-[var(--text-muted)]"
      >
        No runs recorded.
      </div>
    );
  }

  return (
    <div data-testid="status-runs-list" className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-[var(--text-muted)] border-b border-[var(--border)]">
            <th className="py-2 pr-4">Started</th>
            <th className="py-2 pr-4">Duration</th>
            <th className="py-2 pr-4">State</th>
            <th className="py-2 pr-4">Triggered</th>
            <th className="py-2">Summary</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => {
            const tone = runTone(r);
            const label = runStateLabel(r);
            const startedMs = Date.parse(r.startedAt);
            const startedRel = Number.isFinite(startedMs)
              ? formatRelative(startedMs, now)
              : r.startedAt;
            const duration =
              r.durationMs != null ? formatDuration(r.durationMs) : "—";
            const summaryText = r.summary
              ? `${r.summary.passed}/${r.summary.total} pass`
              : "—";
            return (
              <tr
                key={r.id}
                data-testid={`status-run-row-${r.id}`}
                className="border-b border-[var(--border)] hover:bg-[var(--surface-hover)]"
              >
                <td className="py-2 pr-4 text-xs tabular-nums">{startedRel}</td>
                <td className="py-2 pr-4 text-xs tabular-nums">{duration}</td>
                <td
                  className={`py-2 pr-4 text-xs ${TONE_CLASS[tone]}`}
                  data-testid={`status-run-row-${r.id}-state`}
                  data-tone={tone}
                >
                  {label}
                </td>
                <td
                  className="py-2 pr-4 text-xs"
                  data-testid={`status-run-row-${r.id}-trigger`}
                >
                  {r.triggered ? (
                    <span className="inline-block rounded border border-[var(--border)] px-1.5 py-0.5 text-[11px] text-[var(--text-secondary)]">
                      manual
                    </span>
                  ) : null}
                </td>
                <td
                  className="py-2 text-xs"
                  data-testid={`status-run-row-${r.id}-summary`}
                >
                  {summaryText}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
