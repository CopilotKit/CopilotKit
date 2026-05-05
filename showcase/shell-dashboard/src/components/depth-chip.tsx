"use client";
/**
 * DepthChip — colored chip showing achieved depth D0-D6.
 *
 * Color mapping (relative to max achievable depth):
 *   depth >= maxDepth = emerald (green) — at ceiling for this cell
 *   1-2 below max     = amber — close but not at ceiling
 *   3+ below max      = red — significantly below ceiling
 *   D0                = gray — exists but no live probe data
 *   unshipped = transparent + dashed border, displays "--"
 *   unsupported = slate border + slate fill, displays "🚫"
 *                 (architectural limit — framework cannot support feature)
 *   regression = red (danger)
 *
 * Fallback (no maxDepth): D4+ green, D2-D3 amber, D0-D1 red.
 */

export interface DepthChipProps {
  depth: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  status: "wired" | "stub" | "unshipped" | "unsupported";
  /** When true, chip renders in red regardless of depth. */
  regression?: boolean;
  /**
   * Maximum achievable depth for this cell. When provided, the chip turns
   * green when `depth >= maxDepth` (i.e. at ceiling), amber when 1-2 levels
   * below, and red when 3+ levels below. This lets cells whose probes only
   * go to D4 show green at D4 instead of the old hardcoded amber.
   */
  maxDepth?: number;
}

/**
 * Background color class by depth tier.
 *
 * When `maxDepth` is supplied the color is relative: green at ceiling,
 * amber within 2 levels, red otherwise. Without `maxDepth` the fallback
 * heuristic is: D4+ green, D2-D3 amber, D0-D1 red.
 */
export function depthColorClass(
  depth: number,
  regression?: boolean,
  maxDepth?: number,
): string {
  if (regression) {
    return "bg-[var(--danger)] text-white";
  }
  if (depth === 0) {
    return "bg-[var(--text-muted)]/20 text-[var(--text-muted)]";
  }
  if (maxDepth !== undefined) {
    if (depth >= maxDepth) return "bg-emerald-600 text-white";
    if (maxDepth - depth <= 2) return "bg-[var(--amber)] text-white";
    return "bg-[var(--danger)] text-white";
  }
  // Fallback when maxDepth unknown
  if (depth >= 4) return "bg-emerald-600 text-white";
  if (depth >= 2) return "bg-[var(--amber)] text-white";
  return "bg-[var(--danger)] text-white";
}

export function DepthChip({
  depth,
  status,
  regression,
  maxDepth,
}: DepthChipProps) {
  if (status === "unshipped") {
    return (
      <span
        data-testid="depth-chip"
        data-status="unshipped"
        className="inline-flex items-center justify-center min-w-[32px] h-5 px-1.5 rounded text-[10px] font-semibold tabular-nums border border-dashed border-[var(--text-muted)]/40 text-[var(--text-muted)]/60"
        title="unshipped"
      >
        --
      </span>
    );
  }

  if (status === "unsupported") {
    // Distinct from "unshipped": architectural limit, not undone work.
    // A slate border + slate fill + 🚫 emoji + descriptive tooltip
    // signals "cannot be supported" rather than "to be done".
    return (
      <span
        data-testid="depth-chip"
        data-status="unsupported"
        className="inline-flex items-center justify-center min-w-[32px] h-5 px-1.5 rounded text-[10px] font-semibold tabular-nums border border-slate-500/40 bg-slate-500/10 text-slate-400"
        title="Not supported by this framework"
      >
        🚫
      </span>
    );
  }

  const colorClass = depthColorClass(depth, regression, maxDepth);

  return (
    <span
      data-testid="depth-chip"
      data-depth={String(depth)}
      className={`inline-flex items-center justify-center min-w-[32px] h-5 px-1.5 rounded text-[10px] font-semibold tabular-nums ${colorClass}`}
      title={`Depth ${depth}${regression ? " (regression)" : ""}`}
    >
      D{depth}
    </span>
  );
}
