"use client";
/**
 * StatsBar — large numbers: wired/stub/unshipped counts + max achieved
 * depth + regression count.
 */

export interface StatsBarProps {
  wired: number;
  stub: number;
  unshipped: number;
  maxDepth: number;
  regressions: number;
}

function Stat({
  value,
  label,
  colorClass,
}: {
  value: number | string;
  label: string;
  colorClass?: string;
}) {
  return (
    <div
      className="flex flex-col items-center"
      data-testid={`stat-${label.toLowerCase()}`}
    >
      <span
        className={`text-2xl font-bold tabular-nums ${colorClass ?? "text-[var(--text)]"}`}
      >
        {value}
      </span>
      <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
        {label}
      </span>
    </div>
  );
}

export function StatsBar({
  wired,
  stub,
  unshipped,
  maxDepth,
  regressions,
}: StatsBarProps) {
  return (
    <div data-testid="stats-bar" className="flex items-center gap-8 px-4 py-3">
      <Stat value={wired} label="Wired" colorClass="text-[var(--ok)]" />
      <Stat value={stub} label="Stub" colorClass="text-[var(--amber)]" />
      <Stat
        value={unshipped}
        label="Unshipped"
        colorClass="text-[var(--text-muted)]"
      />
      <Stat
        value={`D${maxDepth}`}
        label="Max Depth"
        colorClass="text-[var(--accent)]"
      />
      <Stat
        value={regressions}
        label="Regressions"
        colorClass={
          regressions > 0 ? "text-[var(--danger)]" : "text-[var(--text-muted)]"
        }
      />
    </div>
  );
}
