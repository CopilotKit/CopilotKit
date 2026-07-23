"use client";
/**
 * StatusRunsList — recent-runs table inside the probe-detail panel.
 *
 * Columns: Started (relative) | Duration | State | Triggered | Summary.
 *
 * Tone of the State badge:
 *   - "running" — finishedAt is null (in-flight)
 *   - "red"     — summary.failed > 0 (any test failed) — represents a "failed" run
 *   - "amber"   — finished, no failures, but passed < total (partial pass:
 *                 some services skipped/unknown). R2-D.4: previously rendered
 *                 as green "completed" which misleads the operator.
 *   - "green"   — finished and all targets passed
 *   - "gray"    — finished but no summary (unknown coverage)
 *
 * Reuses `formatDuration` and `formatRelative` from status-table so the
 * dashboard's time/duration formatting stays consistent across views.
 */
import { Fragment, useEffect, useState, useCallback } from "react";
import { formatDuration, formatRelative } from "./status-table";
import type { ProbeRun, ProbeRunServiceResult } from "../lib/ops-api";

export interface StatusRunsListProps {
  runs: ProbeRun[];
}

type StateTone = "green" | "amber" | "red" | "running" | "gray";

const TONE_CLASS: Record<StateTone, string> = {
  green: "text-[var(--ok)]",
  amber: "text-[var(--amber)]",
  red: "text-[var(--danger)]",
  running: "text-[var(--accent)]",
  gray: "text-[var(--text-muted)]",
};

function runTone(run: ProbeRun): StateTone {
  if (!run.finishedAt) return "running";
  if (run.summary) {
    if (run.summary.failed > 0) return "red";
    // R2-D.4: failed=0 is necessary but not sufficient for green. If
    // some services were skipped/unknown (passed < total) we render
    // amber + "partial" so the operator doesn't misread an incomplete
    // run as fully green.
    if (run.summary.passed < run.summary.total) return "amber";
    return "green";
  }
  // Finished but no summary recorded — treat as gray (unknown) rather
  // than green so we don't mislead the operator about coverage.
  return "gray";
}

function runStateLabel(run: ProbeRun): string {
  if (!run.finishedAt) return "running";
  if (run.summary) {
    if (run.summary.failed > 0) return "failed";
    if (run.summary.passed < run.summary.total) {
      const skipped = run.summary.total - run.summary.passed;
      return `partial (${skipped} skipped)`;
    }
    return "completed";
  }
  // Finished but no summary recorded — match runTone()'s "gray" tone
  // with an "unknown" label so the badge can't say "completed" when
  // we actually have no idea whether the run succeeded.
  return "unknown";
}

function useNowTick(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

const SERVICE_ICON: Record<string, string> = {
  completed: "✅",
  failed: "❌",
};

/**
 * Result-aware icon for historical run service chips. Completed services
 * with result "red" or "yellow" should not show ✅ — mirrors the fix
 * in status-running-panel.tsx for inflight services.
 */
const RESULT_ICON: Record<string, string> = {
  green: "✅",
  yellow: "⚠️",
  red: "❌",
};

function serviceChipIcon(svc: ProbeRunServiceResult): string {
  if (svc.state === "completed" && svc.result) {
    return RESULT_ICON[svc.result] ?? SERVICE_ICON[svc.state] ?? "—";
  }
  return SERVICE_ICON[svc.state] ?? "—";
}

function ServiceChip({ svc }: { svc: ProbeRunServiceResult }) {
  const icon = serviceChipIcon(svc);
  return (
    <div
      data-testid={`run-service-${svc.slug}`}
      data-state={svc.state}
      className="flex items-center gap-1.5 px-2 py-1 rounded border border-[var(--border)]"
    >
      <span aria-hidden="true">{icon}</span>
      <span className="font-mono truncate">{svc.slug}</span>
    </div>
  );
}

export function StatusRunsList({ runs }: StatusRunsListProps) {
  const now = useNowTick();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggleExpanded = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

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
            const services = r.summary?.services;
            const hasServices = services && services.length > 0;
            const isExpanded = expanded.has(r.id);
            return (
              <Fragment key={r.id}>
                <tr
                  data-testid={`status-run-row-${r.id}`}
                  onClick={hasServices ? () => toggleExpanded(r.id) : undefined}
                  className={`border-b border-[var(--border)] hover:bg-[var(--surface-hover)] ${hasServices ? "cursor-pointer" : ""}`}
                >
                  <td className="py-2 pr-4 text-xs tabular-nums">
                    {hasServices && (
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
                    )}
                    {startedRel}
                  </td>
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
                {isExpanded && hasServices && (
                  <tr
                    key={`${r.id}-detail`}
                    className="border-b border-[var(--border)]"
                  >
                    <td colSpan={5} className="py-2 px-4">
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5 text-[11px]">
                        {services.map((svc) => (
                          <ServiceChip key={svc.slug} svc={svc} />
                        ))}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
