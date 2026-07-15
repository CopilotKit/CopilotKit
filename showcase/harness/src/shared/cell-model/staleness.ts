/**
 * Staleness windows + the shared `isStale` predicate — the single source of
 * truth for "a green row from a stalled driver must not credit its depth".
 *
 * Extracted from `cell-model.ts` (which owned the constants and a private
 * `isStale`) and `components/depth-utils.ts` (which carried a byte-identical
 * private `isRowStale` duplicate). Centralizing here lets `cell-model.ts`,
 * `components/depth-utils.ts`, and `lib/live-status.ts` all share one
 * implementation without forming an import cycle — this module imports only a
 * type from `live-status.ts`, so there is no runtime dependency edge.
 */

import type { StatusRow } from "./live-status.js";

/**
 * Staleness window for the `e2e:` dimension. The e2e-demos driver writes
 * `e2e:<slug>/<feature>` rows hourly (`schedule: "10 * * * *"`, see
 * harness/config/probes/e2e-demos.yml). When the driver stops writing
 * (a wedged browser pool, a dead probe pipeline), the last row freezes —
 * a green row then reads as a healthy D3 forever, masking the outage as a
 * false-green. Mirroring the original ">6h stale" model (see
 * live-status.ts), a green e2e row whose `observed_at` is older than this
 * window is downgraded to `degraded` (amber) so the staleness surfaces
 * instead of presenting as green. 6h tolerates several missed hourly ticks
 * before flagging, avoiding flapping on a single skipped run.
 */
export const E2E_STALE_AFTER_MS = 6 * 60 * 60 * 1000;

/**
 * Staleness window for the D4 (real-time chat/tools) dimension. The
 * `chat:<slug>`/`tools:<slug>` drivers write on their own cadence; a
 * frozen-green D4 row from a stalled driver must NOT credit D4 forever. A
 * green D4 row older than this window is downgraded to `degraded` (amber) so
 * the staleness surfaces, mirroring the D3/D5/D6 downgrade. Not env-tunable.
 */
export const D4_STALE_AFTER_MS = 60 * 60 * 1000;

/**
 * Staleness window for the D1/D2 (liveness — `health:<slug>`/`agent:<slug>`)
 * dimensions. Tighter than the e2e window because liveness probes are the
 * most frequently written signals; a frozen-green liveness row is a strong
 * stalled-driver indicator. Consumed by `depth-utils.ts` (cell-model has no
 * D1/D2 resolution — D3's failure implicitly covers the D1/D2 gate). Not
 * env-tunable.
 */
export const LIVENESS_STALE_AFTER_MS = 45 * 60 * 1000;

/**
 * Staleness window for the `starter` dimension (`starter:<column>/<level>`
 * rows written by the harness `starter_smoke` probe family). Per spec §d, the
 * window is derived from the probe cadence and MUST be strictly greater than
 * two probe periods, so a single late/missed/slow-wake tick stays green and
 * only two consecutive misses flip amber. The probe ships on an HOURLY cadence
 * (`schedule: "40 * * * *"`, see harness/config/probes/starter_smoke.yml), so
 * the probe period is 1h. We set the window to 2.5h: > 2×1h (so two consecutive
 * missed hourly ticks, which age the last row to ~2h, then ~3h, flip amber on
 * the SECOND miss) yet < 3h (so a single missed/slow-wake tick — last row ~2h
 * old — stays green, absorbing a scale-to-zero cold-start wake folded into one
 * tick, §c). 2.5h is the tightest window satisfying ">2 periods" that still
 * trips on the second miss. Keep this in lockstep with S2's `starter_smoke.yml`
 * `schedule` — if the cadence changes, this window must be re-derived
 * (> 2× the new period). Not env-tunable.
 */
export const STARTER_STALE_AFTER_MS = 2.5 * 60 * 60 * 1000;

/**
 * Determine whether a row's `observed_at` is older than `maxAgeMs` relative
 * to `now`. An unparseable/missing timestamp is treated as NOT stale —
 * staleness must be a positive signal, never inferred from bad data.
 */
export function isStale(
  row: StatusRow,
  now: number,
  maxAgeMs: number,
): boolean {
  const observedMs = Date.parse(row.observed_at);
  if (Number.isNaN(observedMs)) return false;
  return now - observedMs > maxAgeMs;
}
