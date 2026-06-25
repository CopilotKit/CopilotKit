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
import { createContext, useContext, type ReactNode } from "react";

import type { WorkerFamilySummary } from "./ops-api";
import type { WorkerRunsStatus } from "../hooks/use-worker-runs";

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
 */
export function isFamilySilent(
  entry: WorkerFamilySummary,
  nowMs: number,
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
  return nowMs - referenceMs > 2 * periodMs;
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
