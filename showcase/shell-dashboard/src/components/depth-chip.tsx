"use client";
/**
 * DepthChip — colored chip showing achieved depth D0-D4.
 *
 * Color mapping:
 *   D3-D4 = blue (accent) — meaningful e2e + interaction coverage
 *   D1-D2 = amber — basic health and agent checks
 *   D0    = gray — exists but no live probe data
 *   unshipped = transparent + dashed border, displays "--"
 *   regression = red (danger)
 */

export interface DepthChipProps {
  depth: 0 | 1 | 2 | 3 | 4;
  status: "wired" | "stub" | "unshipped";
  /** When true, chip renders in red regardless of depth. */
  regression?: boolean;
}

/** Background color class by depth tier. */
function depthColorClass(depth: number, regression?: boolean): string {
  if (regression) {
    return "bg-[var(--danger)] text-white";
  }
  switch (depth) {
    case 3:
    case 4:
      return "bg-[var(--accent)] text-white";
    case 1:
    case 2:
      return "bg-[var(--amber)] text-white";
    case 0:
    default:
      return "bg-[var(--text-muted)]/20 text-[var(--text-muted)]";
  }
}

export function DepthChip({ depth, status, regression }: DepthChipProps) {
  if (status === "unshipped") {
    return (
      <span
        data-testid="depth-chip"
        className="inline-flex items-center justify-center min-w-[32px] h-5 px-1.5 rounded text-[10px] font-semibold tabular-nums border border-dashed border-[var(--text-muted)]/40 text-[var(--text-muted)]/60"
        title="unshipped"
      >
        --
      </span>
    );
  }

  const colorClass = depthColorClass(depth, regression);

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
