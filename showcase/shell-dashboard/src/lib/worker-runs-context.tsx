"use client";
/**
 * `WorkerRunsContext` — exposes the §6.1 `WorkerRunsStatus` poll result to
 * matrix components without prop-drilling (spec §7.1), plus the shared
 * pure helpers the §7.3 glyph and §7.4 banner consume.
 *
 * NO-PROVIDER CONTRACT (load-bearing for T13 — do not weaken):
 * the context is created with a safe default value (`null`, the no-data
 * default), and `useWorkerRuns()` NEVER throws when no provider is
 * mounted — it simply returns that default. Consumers treat `null` as
 * "no worker-runs data" and render no glyph/banner/section content. This
 * is what keeps pre-existing provider-less renders green once T13's
 * consumers call the hook (e.g. `cell-pieces.signal-degrade.test.tsx`
 * renders `CellStatus` with no `WorkerRunsProvider` and asserts
 * `not.toThrow`). `null` is also the provider-mounted value until the
 * first poll settles, so consumers have exactly one no-data case.
 */
import { createContext, useContext } from "react";
import type { ReactNode } from "react";

import type { WorkerFamilySummary, WorkerView } from "./ops-api";
import type { WorkerRunsStatus } from "../hooks/use-worker-runs";

/**
 * Post-bounce drain grace, in resolved periods — mirrors the §9 monitor's
 * `BOUNCE_GRACE_PERIOD_MULTIPLIER` (=2). A NORMAL harness deploy rebuilds the
 * shared image and bounces the pool workers (PR #5715); for ~1–2 sweep cycles
 * afterward each family is legitimately mid-sweep with a still-stale
 * `lastSuccessAt`, so neither the §7.3 glyph nor the §7.4 banner should flag
 * silence. This 2×period bounce-grace TERM is the one piece the dashboard and
 * the §9 Slack monitor share verbatim (both key off the same worker
 * `registeredAt` shipped in the `/api/runs` workers strip): within 2 periods
 * of a bounce neither surface flags silence, beyond it both can. The
 * silence-ONSET threshold, by contrast, is NOT shared — the dashboard treats
 * a family silent at 2×period (see `isFamilySilent` below) while the server
 * pager requires 3×period plus a 3-tick debounce; that onset asymmetry is
 * pre-existing / by-design (visual hint vs. pager) and only the grace term is
 * intentionally kept in lockstep.
 */
export const BOUNCE_GRACE_PERIOD_MULTIPLIER = 2;

/**
 * The fleet's most-recent worker (re)registration instant — the bounce signal
 * the post-bounce drain grace keys off. Returns the freshest parseable
 * `registeredAt` across the workers strip, or null when none is present (empty
 * strip / pre-migration rows), which disables the grace and preserves
 * pre-change behavior. A worker can be bounced while the control-plane stays
 * up, so the worker-registration instant — not any CP-side timer — is the
 * correct, independent bounce signal.
 */
export function freshestBounceMs(
  workers: readonly WorkerView[] | undefined,
): number | null {
  if (!workers) return null;
  let freshest: number | null = null;
  for (const worker of workers) {
    if (!worker.registeredAt) continue;
    const ms = Date.parse(worker.registeredAt);
    if (Number.isNaN(ms)) continue;
    if (freshest === null || ms > freshest) freshest = ms;
  }
  return freshest;
}

/**
 * `null` = no provider mounted OR the first poll has not settled yet.
 * Either way: no worker-runs data — render no glyph/banner.
 */
export type WorkerRunsContextValue = WorkerRunsStatus | null;

const WorkerRunsContext = createContext<WorkerRunsContextValue>(null);

export function WorkerRunsProvider({
  value,
  children,
}: {
  value: WorkerRunsContextValue;
  children: ReactNode;
}) {
  return (
    <WorkerRunsContext.Provider value={value}>
      {children}
    </WorkerRunsContext.Provider>
  );
}

/**
 * Consume the worker-runs poll status. Never throws — absent a provider
 * this returns the no-data default (`null`). See the no-provider contract
 * in the module header.
 */
export function useWorkerRuns(): WorkerRunsContextValue {
  return useContext(WorkerRunsContext);
}

// ─────────────────────────────────────────────────────────────────────────
// Shared pure helpers — §7.3 (cell glyph) / §7.4 (coverage banner)
// ─────────────────────────────────────────────────────────────────────────

/**
 * §7.3/§7.4: family silent = no success within 2×`periodMs`.
 *
 * - The period is the SERVER-computed `periodMs` the family entry carries
 *   (§5.2.1), consumed verbatim — NO client cron parsing (the `schedule`
 *   string is display-only).
 * - Null `lastSuccessAt` falls back to the oldest known batch's
 *   `enqueuedAt` (§5.2.1 null rule): `lastRun` when present (older than
 *   `inflight` by construction — inflight is the newest group), else
 *   `inflight`. "Has been trying and failing for 2 periods" is exactly as
 *   alarming as "stopped succeeding 2 periods ago".
 * - Zero batches → never silent (fresh env before the first producer
 *   tick).
 * - A degraded entry (`error: "history_unavailable"` — no `periodMs`) is
 *   never classified silent here; §6.1 surfaces that as the `unavailable`
 *   incident class instead.
 * - POST-BOUNCE DRAIN: when `bounceAtMs` (the fleet's freshest worker
 *   `registeredAt`, via `freshestBounceMs`) is within
 *   `BOUNCE_GRACE_PERIOD_MULTIPLIER` periods of now, the family is
 *   legitimately mid-sweep after a deploy bounce (PR #5715) and is NOT
 *   silent — this is the SAME 2×period bounce-grace term the §9 Slack monitor
 *   applies, so for the grace window banner/glyph and pager agree. (The
 *   silence-onset thresholds differ — 2×period here vs. 3×period + 3-tick
 *   debounce server-side — by design; see the module-level grace JSDoc.) Pass
 *   `null` (or omit) to disable the grace.
 */
export function isFamilySilent(
  entry: WorkerFamilySummary,
  nowMs: number,
  bounceAtMs: number | null = null,
): boolean {
  const periodMs = entry.periodMs;
  if (typeof periodMs !== "number" || periodMs <= 0) return false;
  const reference =
    entry.lastSuccessAt ??
    entry.lastRun?.enqueuedAt ??
    entry.inflight?.enqueuedAt ??
    null;
  if (!reference) return false;
  const referenceMs = Date.parse(reference);
  // Unparseable reference time: conservatively not-silent — a malformed
  // payload must not paint silence glyphs across the matrix.
  if (Number.isNaN(referenceMs)) return false;
  if (nowMs - referenceMs <= 2 * periodMs) return false;
  // Post-bounce drain grace: a recent fleet bounce means the family is
  // draining, not silent (see the JSDoc + the §9 monitor's matching gate).
  if (
    bounceAtMs !== null &&
    nowMs - bounceAtMs < BOUNCE_GRACE_PERIOD_MULTIPLIER * periodMs
  ) {
    return false;
  }
  return true;
}

/**
 * §7.2: map a matrix cell key (`<prefix>:<slug>`) to its family entry via
 * the `probeKeyPrefix` each family echoes in the `/api/runs` payload —
 * never a dashboard-side prefix table (that would be exactly the
 * cross-component drift the §5.1 drift-lock test exists to prevent).
 *
 * Matches the exact prefix segment before the first `:` — `d6x:slug`
 * never matches the `d6` family. Keys without a `:` map to no family.
 */
export function familyForProbeKey(
  key: string,
  families: WorkerFamilySummary[],
): WorkerFamilySummary | undefined {
  const separator = key.indexOf(":");
  if (separator <= 0) return undefined;
  const prefix = key.slice(0, separator);
  return families.find((family) => family.probeKeyPrefix === prefix);
}
