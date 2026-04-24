"use client";
/**
 * CoverageBar — 6px horizontal bar with green (wired) / amber (stub) /
 * gray (unshipped) segments proportional to counts.
 */

export interface CoverageBarProps {
  wired: number;
  stub: number;
  unshipped: number;
}

export function CoverageBar({ wired, stub, unshipped }: CoverageBarProps) {
  const total = wired + stub + unshipped;
  if (total === 0) return null;

  const pctWired = (wired / total) * 100;
  const pctStub = (stub / total) * 100;
  // unshipped fills the rest

  return (
    <div
      data-testid="coverage-bar"
      className="w-full h-1.5 rounded-full overflow-hidden flex bg-[var(--text-muted)]/20"
      title={`${wired} wired / ${stub} stub / ${unshipped} unshipped`}
    >
      {pctWired > 0 && (
        <div
          className="h-full bg-[var(--ok)]"
          style={{ width: `${pctWired}%` }}
        />
      )}
      {pctStub > 0 && (
        <div
          className="h-full bg-[var(--amber)]"
          style={{ width: `${pctStub}%` }}
        />
      )}
      {/* Gray (unshipped) is the background, so no explicit segment needed */}
    </div>
  );
}
