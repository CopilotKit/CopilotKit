/**
 * URL composition for the exec skin's agent-driven navigations, factored out
 * so it can be unit-tested without rendering the full tools tree.
 *
 * Deliberately does NOT call `useSkinHref` itself — it is a plain, hook-free
 * function so it can be exercised directly in tests. The caller is expected to
 * pass the result to `useSkinHref("exec")`, which is what keeps the output
 * lock-safe (never prefixed with `/exec`). Enforcing that here as well would
 * double-apply the skin base, so this function returns a bare
 * segment-plus-query string and nothing more.
 *
 * Every lever is OMITTED, never defaulted, when unset or unusable: a caller
 * that doesn't care about `period` should not see a `period=` key appear, and
 * an agent that hands us a fractional or negative `top` should not see it
 * silently clamped to some fallback — it should see the key vanish so the
 * omission is visible in the resulting URL.
 */
export interface ExecNavTargetArgs {
  segment?: string;
  period?: string;
  department?: string;
  threshold?: boolean;
  top?: number;
}

/** A positive integer: whole and greater than zero. Rejects 2.5, -1, 0, NaN, Infinity. */
function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

export function execNavTarget(args: ExecNavTargetArgs): string {
  const { segment, period, department, threshold, top } = args;

  const params = new URLSearchParams();
  if (department) params.set("department", department);
  if (period) params.set("period", period);
  if (typeof top === "number" && isPositiveInteger(top)) {
    params.set("top", String(top));
  }
  if (threshold) params.set("threshold", "1");

  const qs = params.toString();
  const base = segment ?? "";
  return qs ? `${base}?${qs}` : base;
}
