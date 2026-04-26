"use client";
/**
 * StatusTable — Probe Schedule grid.
 *
 * Columns: Probe | Schedule (humanized cron) | Next Run (relative) |
 *          Last Run (relative) | Duration | Result | Actions.
 *
 * Relative times update live every 1s via a local tick state — no
 * full re-fetch needed; the parent owns the data.
 */
import { useEffect, useState } from "react";
import { StatusTriggerButton } from "./status-trigger-button";
import type { ProbeScheduleEntry } from "./status-tab";

export interface StatusTableProps {
  entries: ProbeScheduleEntry[];
  onTrigger: (probeId: string, slugs?: string[]) => Promise<void>;
  /**
   * Optional handler invoked when the operator clicks a probe row (outside
   * the trigger button). Used by the parent to open the drilldown panel.
   */
  onSelect?: (probeId: string) => void;
}

/** Humanize a 5-field cron expression into a short label. */
export function humanizeCron(expr: string): string {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return expr;
  const [min, hour, dom, mon, dow] = parts;

  // Every Nh: "0 */N * * *". Reject `*/0` — that's not a valid step.
  const everyHourMatch = hour.match(/^\*\/(\d+)$/);
  if (
    everyHourMatch &&
    Number(everyHourMatch[1]) > 0 &&
    min === "0" &&
    dom === "*" &&
    mon === "*" &&
    dow === "*"
  ) {
    return `Every ${everyHourMatch[1]}h`;
  }

  // Every Nm: "*/N * * * *". Reject `*/0`.
  const everyMinMatch = min.match(/^\*\/(\d+)$/);
  if (
    everyMinMatch &&
    Number(everyMinMatch[1]) > 0 &&
    hour === "*" &&
    dom === "*" &&
    mon === "*" &&
    dow === "*"
  ) {
    return `Every ${everyMinMatch[1]}m`;
  }

  // Hourly: "0 * * * *"
  if (
    min === "0" &&
    hour === "*" &&
    dom === "*" &&
    mon === "*" &&
    dow === "*"
  ) {
    return "Every 1h";
  }

  // Daily at HH:MM: "M H * * *" — accept any literal minute, not just 0.
  if (
    /^\d+$/.test(hour) &&
    /^\d+$/.test(min) &&
    dom === "*" &&
    mon === "*" &&
    dow === "*"
  ) {
    return `Daily at ${hour.padStart(2, "0")}:${min.padStart(2, "0")}`;
  }

  return expr;
}

/** Render a duration as compact "Xh Ym" / "Ym Zs" / "Zs". */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** Relative-time formatter ("in 4h 23m" / "1h 37m ago"). */
export function formatRelative(targetMs: number, nowMs: number): string {
  if (!Number.isFinite(targetMs) || !Number.isFinite(nowMs)) return "—";
  const deltaMs = targetMs - nowMs;
  const absMs = Math.abs(deltaMs);

  // Sub-second deltas read awkwardly as "in 0s" / "0s ago" — collapse
  // to a single "now" sentinel so the dashboard doesn't flicker
  // between sides of the boundary on every tick.
  if (absMs < 1000) return "now";

  const future = deltaMs >= 0;
  const totalSec = Math.floor(absMs / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;

  let body: string;
  if (h > 0) body = `${h}h ${m}m`;
  else if (m > 0) body = `${m}m`;
  else body = `${s}s`;

  return future ? `in ${body}` : `${body} ago`;
}

function lastRunTone(
  lastRun: ProbeScheduleEntry["lastRun"],
): "green" | "red" | "gray" {
  if (!lastRun) return "gray";
  if (lastRun.state === "failed") return "red";
  // summary may be null on a "completed" run produced by a failure path
  // (see ops-api ProbeLastRun contract). Without per-service counts we
  // can't claim green — match the runs-list "unknown" semantics.
  if (!lastRun.summary) return "gray";
  if (lastRun.summary.failed > 0) return "red";
  return "green";
}

const TONE_CLASS: Record<"green" | "red" | "gray", string> = {
  green: "text-[var(--ok)]",
  red: "text-[var(--danger)]",
  gray: "text-[var(--text-muted)]",
};

function useNowTick(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export function StatusTable({
  entries,
  onTrigger,
  onSelect,
}: StatusTableProps) {
  const now = useNowTick();

  return (
    <div data-testid="status-table" className="px-8 py-4">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-[var(--text-muted)] border-b border-[var(--border)]">
            <th className="py-2 pr-4">Probe</th>
            <th className="py-2 pr-4">Schedule</th>
            <th className="py-2 pr-4">Next Run</th>
            <th className="py-2 pr-4">Last Run</th>
            <th className="py-2 pr-4">Duration</th>
            <th className="py-2 pr-4">Result</th>
            <th className="py-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => {
            const tone = lastRunTone(e.lastRun);
            const nextRunMs = e.nextRunAt ? Date.parse(e.nextRunAt) : null;
            const lastStartMs = e.lastRun
              ? Date.parse(e.lastRun.startedAt)
              : null;
            const result = e.lastRun
              ? e.lastRun.summary
                ? `${e.lastRun.summary.passed}/${e.lastRun.summary.total} pass`
                : "—"
              : "never run";
            const slugs = e.inflight?.services.map((s) => s.slug) ?? [];
            return (
              <tr
                key={e.id}
                data-testid={`status-row-${e.id}`}
                onClick={onSelect ? () => onSelect(e.id) : undefined}
                className={`border-b border-[var(--border)] hover:bg-[var(--surface-hover)] ${
                  onSelect ? "cursor-pointer" : ""
                }`}
              >
                <td className="py-2 pr-4 font-mono text-xs">{e.id}</td>
                <td className="py-2 pr-4 text-xs text-[var(--text-secondary)]">
                  {humanizeCron(e.schedule)}
                </td>
                <td className="py-2 pr-4 text-xs tabular-nums">
                  {nextRunMs !== null ? formatRelative(nextRunMs, now) : "—"}
                </td>
                <td className="py-2 pr-4 text-xs tabular-nums">
                  {lastStartMs !== null
                    ? formatRelative(lastStartMs, now)
                    : "never"}
                </td>
                <td className="py-2 pr-4 text-xs tabular-nums">
                  {e.lastRun ? formatDuration(e.lastRun.durationMs) : "—"}
                </td>
                <td
                  className={`py-2 pr-4 text-xs ${TONE_CLASS[tone]}`}
                  data-testid={`status-row-${e.id}-result`}
                  data-tone={tone}
                >
                  {result}
                </td>
                <td
                  className="py-2"
                  onClick={onSelect ? (ev) => ev.stopPropagation() : undefined}
                >
                  <StatusTriggerButton
                    probeId={e.id}
                    serviceSlugs={slugs}
                    onTrigger={onTrigger}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
