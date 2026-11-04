import {
  normalizeDepartmentLever,
  normalizePeriodLever,
} from "./pages/metric-rows";

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
 *
 * "Unusable" is decided by the SAME functions the Metrics Explorer reads the
 * query string back with (`normalizePeriodLever` / `normalizeDepartmentLever`,
 * `./pages/metric-rows`), so this module cannot emit a lever that page would
 * then ignore. That matters most for the `"any"` sentinel: `tools.tsx`'s
 * `navigateTo` requires every lever and spells "leave this one alone" as
 * `"any"`, mapping it back to `undefined` at the call site (~line 1078). That
 * one ternary was all that stood between the sentinel and the query string —
 * anything reaching here without it emitted `?period=any`, which matches no
 * point and empties the table under a confidently tinted control. Both ends
 * now agree without depending on a caller to remember.
 *
 * ONE JOIN THIS MODULE CANNOT MAKE, and does not have to. `navigateTo`'s
 * `segment` enum includes `""` (the CEO dashboard), so a levered nav to the
 * index emits a QUERY-ONLY target — `"?department=…"` with no path half at
 * all. `useSkinHref` joins whatever it is given as a path segment, so handing
 * it that string whole would compose `/exec/?department=…`, with a stray
 * slash the rest of the app never emits. Prefixing the base here to normalize
 * that would double-apply it (see above), so the join is made ON THE CALLER'S
 * SIDE instead: `tools.tsx`'s `navigateTo` handler runs the result through
 * `splitTargetQuery` and gives `skinHref` only the path half, appending the
 * query after it. The index segment therefore yields `skinHref("")` — `/exec`
 * unlocked, `/` locked — plus `?department=…`, both clean.
 *
 * This module's side of that contract — a query-only string, never a
 * `/exec`-prefixed one — is pinned by `./nav-target.test.ts`'s "emits a
 * query-only target for the index segment" and "never returns a value
 * prefixed with /exec".
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
  const normalizedDepartment = normalizeDepartmentLever(department);
  if (normalizedDepartment) params.set("department", normalizedDepartment);
  const normalizedPeriod = normalizePeriodLever(period);
  if (normalizedPeriod) params.set("period", normalizedPeriod);
  if (typeof top === "number" && isPositiveInteger(top)) {
    params.set("top", String(top));
  }
  if (threshold) params.set("threshold", "1");

  const qs = params.toString();
  const base = segment ?? "";
  return qs ? `${base}?${qs}` : base;
}
