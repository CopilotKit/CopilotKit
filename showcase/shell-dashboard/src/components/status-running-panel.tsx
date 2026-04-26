"use client";
/**
 * StatusRunningPanel — "currently running" card or idle fallback.
 *
 * For each inflight probe, renders a card with elapsed time, a
 * completed/total progress bar, and a per-service grid annotated by
 * state (queued / running / completed / failed).
 *
 * When no probe is inflight, renders an idle line that names the next
 * scheduled probe and how long until it fires.
 */
import { useEffect, useState } from "react";
import { formatDuration, formatRelative } from "./status-table";
import type { ProbeScheduleEntry } from "./status-tab";

export interface StatusRunningPanelProps {
  entries: ProbeScheduleEntry[];
}

// Typed as Record<ServiceState, string> so removing or renaming a state
// in ProbeScheduleEntry surfaces here at compile time rather than
// silently rendering `undefined` in the per-service grid.
type ServiceState = NonNullable<
  ProbeScheduleEntry["inflight"]
>["services"][number]["state"];

const STATE_ICON: Record<ServiceState, string> = {
  completed: "✅",
  running: "⏳",
  queued: "⏸",
  failed: "❌",
};

function useNowTick(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/**
 * Find the soonest *future* nextRunAt across the schedule.
 *
 * We deliberately ignore entries whose nextRunAt is already in the past:
 * those represent overdue probes (the scheduler hasn't ticked them yet)
 * and reporting "Next: smoke 5m ago" reads as nonsensical to the
 * operator. When no future entry exists we return null and the caller
 * renders the "No upcoming runs scheduled" sentinel instead.
 */
function findNextScheduled(
  entries: ProbeScheduleEntry[],
  nowMs: number,
): { entry: ProbeScheduleEntry; ms: number } | null {
  let best: { entry: ProbeScheduleEntry; ms: number } | null = null;
  for (const e of entries) {
    if (!e.nextRunAt) continue;
    const ms = Date.parse(e.nextRunAt);
    if (Number.isNaN(ms)) continue;
    if (ms < nowMs) continue;
    if (!best || ms < best.ms) best = { entry: e, ms };
  }
  return best;
}

export function StatusRunningPanel({ entries }: StatusRunningPanelProps) {
  const now = useNowTick();
  const inflight = entries.filter((e) => e.inflight);

  if (inflight.length === 0) {
    const next = findNextScheduled(entries, now);
    return (
      <div
        data-testid="status-running-panel"
        className="px-8 py-4 border-t border-[var(--border)]"
      >
        <div
          data-testid="running-idle"
          className="text-xs text-[var(--text-muted)]"
        >
          {next
            ? `All probes idle. Next: ${next.entry.id} ${formatRelative(next.ms, now)}.`
            : "All probes idle. No upcoming runs scheduled."}
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="status-running-panel"
      className="px-8 py-4 border-t border-[var(--border)] flex flex-col gap-4"
    >
      {inflight.map((e) => {
        const startedMs = Date.parse(e.inflight!.startedAt);
        const elapsedMs = Number.isFinite(startedMs)
          ? Math.max(0, now - startedMs)
          : e.inflight!.elapsedMs;
        const services = e.inflight!.services;
        const total = services.length;
        const completed = services.filter(
          (s) => s.state === "completed" || s.state === "failed",
        ).length;
        const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

        return (
          <div
            key={e.id}
            data-testid={`running-card-${e.id}`}
            className="rounded border border-[var(--border)] bg-[var(--surface)] p-3"
          >
            <div className="flex items-center justify-between mb-2 text-xs">
              <span className="font-mono text-[var(--text-secondary)]">
                {e.id}
              </span>
              <span className="text-[var(--text-muted)]">
                running, {formatDuration(elapsedMs)} elapsed
              </span>
            </div>

            <div
              data-testid={`running-progress-${e.id}`}
              data-completed={completed}
              data-total={total}
              className="h-1.5 w-full bg-[var(--border)] rounded overflow-hidden mb-3"
            >
              <div
                className="h-full bg-[var(--accent)] transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5 text-[11px]">
              {services.map((s) => {
                const sStart = s.startedAt ? Date.parse(s.startedAt) : null;
                const sElapsed =
                  s.state === "running" && sStart !== null
                    ? formatDuration(Math.max(0, now - sStart))
                    : null;
                return (
                  <div
                    key={s.slug}
                    data-testid={`running-service-${e.id}-${s.slug}`}
                    data-state={s.state}
                    className="flex items-center gap-1.5 px-2 py-1 rounded border border-[var(--border)]"
                  >
                    <span aria-hidden="true">{STATE_ICON[s.state]}</span>
                    <span className="font-mono truncate">{s.slug}</span>
                    {sElapsed && (
                      <span className="ml-auto text-[var(--text-muted)] tabular-nums">
                        {sElapsed}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
