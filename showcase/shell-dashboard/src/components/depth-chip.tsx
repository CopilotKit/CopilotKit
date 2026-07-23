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
  /**
   * Pre-computed color override. When provided, bypasses the internal
   * `depthColorClass()` derivation entirely. Useful when the caller has
   * already determined the correct color (e.g. green when achieved == ceiling).
   */
  chipColor?: "green" | "amber" | "red" | "gray";
  /**
   * Pool COMMUNICATION error (REQ-B). When set, the chip renders a DISTINCT
   * "couldn't reach the pool" treatment — an indigo fill with a "⚡"
   * glyph — that is visually unlike green/amber/red/gray, so an operator can
   * tell "the pool was unreachable" apart from "the test went red". The
   * underlying depth/colour is intentionally suppressed in favour of the
   * comm-error overlay; the descriptive tooltip is supplied via `commTooltip`.
   */
  unreachable?: boolean;
  /**
   * Pool RECLAIM-PENDING state (flap-band #70). When set, the job's lease
   * lapsed and the control-plane RE-QUEUED it (back in flight). The sweep
   * boundary cannot tell a real crash from an expected platform teardown, so
   * this is NEUTRAL — never red — and stale-while-revalidate applies:
   *
   *   - PRIOR-GOOD (a real last-known result exists: `chipColor` is a real
   *     colour, i.e. not "gray", OR `depth > 0`): keep rendering the
   *     last-known-good COLOURED chip and overlay a NON-DESTRUCTIVE refreshing
   *     affordance (a `⟳` corner badge + a subtle pulsing ring in the chip's
   *     own colour). The colour does NOT change to grey — a re-run of a healthy
   *     cell no longer flaps green → grey → green.
   *   - NO-PRIOR (never-run / first load: `chipColor` is gray/undefined AND
   *     `depth === 0`): render the honest grey `⟳` chip — there is nothing to
   *     preserve yet.
   *
   * `unreachable` takes precedence when both are set (a known crash outranks an
   * ambiguous reclaim).
   */
  pending?: boolean;
  /** Tooltip text for the unreachable / pending treatment (names the kind). */
  commTooltip?: string;
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

/**
 * Map a pre-computed chip color to the corresponding CSS class string.
 * Regression always wins (renders danger red).
 */
export function chipColorToClass(
  color: "green" | "amber" | "red" | "gray",
  regression?: boolean,
): string {
  if (regression) return "bg-[var(--danger)] text-white";
  switch (color) {
    case "green":
      return "bg-emerald-600 text-white";
    case "amber":
      return "bg-[var(--amber)] text-white";
    case "red":
      return "bg-[var(--danger)] text-white";
    case "gray":
      return "bg-[var(--text-muted)]/20 text-[var(--text-muted)]";
  }
}

export function DepthChip({
  depth,
  status,
  regression,
  maxDepth,
  chipColor,
  unreachable,
  pending,
  commTooltip,
}: DepthChipProps) {
  // Pool comm-error overlay (REQ-B) takes precedence over every probe colour:
  // a "couldn't reach the pool" state must never be mistaken for a red test.
  // A distinct indigo fill + ⚡ glyph, resolved BEFORE the unshipped/unsupported
  // branches so an unreachable cell is always loud.
  if (unreachable) {
    return (
      <span
        data-testid="depth-chip"
        data-status="unreachable"
        data-surface-state="unreachable"
        className="inline-flex items-center justify-center min-w-[32px] h-5 px-1.5 rounded text-[10px] font-semibold tabular-nums border border-indigo-400/60 bg-indigo-500/20 text-indigo-300"
        title={commTooltip ?? "pool unreachable — comm error"}
      >
        ⚡
      </span>
    );
  }

  // Reclaim-pending overlay (flap-band #70) — STALE-WHILE-REVALIDATE: the job's
  // lease lapsed and was re-queued (back in flight). NEUTRAL — never red, never
  // the indigo `unreachable` overlay above, so an expected platform teardown
  // never flaps the service red. Resolved before unshipped/unsupported so it
  // always shows, but AFTER `unreachable` (a known crash outranks an ambiguous
  // reclaim).
  if (pending) {
    // Prior-good: a real last-known result exists. A non-gray chipColor means
    // the cell HAS a genuine last-known colour worth preserving; when no
    // chipColor is supplied a depth above zero stands in for that signal.
    // An EXPLICIT gray chipColor means "no live probe data" (the muted
    // no-data fill), so it is NOT prior-good even at depth>0 — a grey depth>0
    // chip falls through to the honest grey ⟳ below rather than claiming a
    // prior result. (Never-run / first load also falls through.)
    const hasPrior =
      chipColor === "gray" ? false : chipColor !== undefined || depth > 0;

    if (hasPrior) {
      // Reuse the default branch's EXACT colour derivation, threading
      // `regression` through so a regression-coloured cell that is also pending
      // keeps its red treatment rather than mis-painting.
      const colorClass = chipColor
        ? chipColorToClass(chipColor, regression)
        : depthColorClass(depth, regression, maxDepth);

      // Decision-table guard: a failure-coloured cell (regression, or any path
      // that resolves to the danger red) must NOT show the ⟳ spinner — it is
      // colour-passthrough only ("failure → no spinner"). Today the data layer
      // never marks a failure pending, so this is defensive; it keeps a red
      // pending cell from reading as "re-running a failure".
      const isFailureColor =
        Boolean(regression) || colorClass.includes("--danger");

      // Pulsing ring in the chip's OWN colour (a translucent emerald/amber/
      // danger ring) rather than a generic white, so the motion cue matches the
      // chip instead of washing it out. Falls back to white only for the gray
      // tier where there is no strong own-colour to tint.
      const ringClass = colorClass.includes("emerald")
        ? "ring-emerald-300/70"
        : colorClass.includes("--amber")
          ? "ring-[var(--amber)]/70"
          : colorClass.includes("--danger")
            ? "ring-[var(--danger)]/70"
            : "ring-white/60";

      return (
        <span
          data-testid="depth-chip"
          data-status="pending"
          data-surface-state="pending"
          {...(isFailureColor ? {} : { "data-refreshing": "true" })}
          data-has-prior="true"
          data-depth={String(depth)}
          role="status"
          aria-label={
            // "regression" is reserved for an ACTUALLY-flagged regression —
            // not any cell that merely resolves to the danger colour (e.g. a
            // depth far below ceiling). A danger-coloured-but-not-flagged cell
            // suppresses the ⟳ spinner the same way (failure → no spinner) but
            // must not be announced as a regression.
            regression
              ? `Depth ${depth} — regression`
              : isFailureColor
                ? `Depth ${depth}`
                : `Depth ${depth} — re-running`
          }
          className={`relative inline-flex items-center justify-center min-w-[32px] h-5 px-1.5 rounded text-[10px] font-semibold tabular-nums ${colorClass}`}
          title={commTooltip ?? "re-queued — pending re-run"}
        >
          {/* Subtle pulsing ring in the chip's own colour. The ring is the
              motion cue; it respects prefers-reduced-motion (motion-reduce
              disables the pulse) so the static ⟳ glyph still carries the
              "refreshing" meaning by SHAPE alone — never by colour. */}
          <span
            aria-hidden="true"
            className={`pointer-events-none absolute inset-0 rounded ring-1 ring-inset ${ringClass} animate-pulse motion-reduce:animate-none`}
          />
          {/* Visually-hidden status text so screen readers announce the
              re-running affordance — the `title` alone is not reliably
              surfaced by assistive tech. Suppressed for failure-coloured
              cells (colour passthrough only — not "re-running"). */}
          {!isFailureColor && <span className="sr-only">re-running</span>}
          <span className="relative inline-flex items-center">
            D{depth}
            {/* Corner refreshing glyph — a distinct SHAPE, not a colour shift,
                so colour-blind operators still perceive "re-running".
                Suppressed for failure-coloured cells (colour passthrough only). */}
            {!isFailureColor && (
              <span
                aria-hidden="true"
                className="ml-0.5 text-[10px] leading-none animate-spin motion-reduce:animate-none"
              >
                ⟳
              </span>
            )}
          </span>
        </span>
      );
    }

    // No-prior (never-run / first load): nothing to preserve — keep today's
    // honest grey ⟳ chip exactly as before.
    return (
      <span
        data-testid="depth-chip"
        data-status="pending"
        data-surface-state="pending"
        data-refreshing="true"
        data-has-prior="false"
        className="inline-flex items-center justify-center min-w-[32px] h-5 px-1.5 rounded text-[10px] font-semibold tabular-nums border border-[var(--text-muted)]/40 bg-[var(--text-muted)]/20 text-[var(--text-muted)]"
        title={commTooltip ?? "re-queued — pending re-run"}
      >
        ⟳
      </span>
    );
  }

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

  const colorClass = chipColor
    ? chipColorToClass(chipColor, regression)
    : depthColorClass(depth, regression, maxDepth);

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
