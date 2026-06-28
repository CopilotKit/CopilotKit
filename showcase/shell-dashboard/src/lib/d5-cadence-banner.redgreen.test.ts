/**
 * Red-green proof for the D5 cadence fix (slow deep sweep 15min -> 30min so
 * the staleness banner stops flapping). This exercises the REAL banner
 * decision path end to end with NO mocks:
 *   - the production `periodMsFromCron` (harness) derives periodMs from the
 *     cron string (server-side derivation), and
 *   - the production `isFamilySilent` (this package) decides the banner at the
 *     2x-periodMs threshold.
 * A ~31-minute-stale d5 family flips from silent (15min cron, 2x=30min) to
 * quiet (30min cron, 2x=60min) purely because the cron changed — proving the
 * fix moves cadence AND the banner threshold in lockstep.
 *
 * `periodMsFromCron` is imported across the package boundary by relative path
 * (the dashboard is a standalone npm app, the harness a pnpm workspace pkg);
 * it pulls in `croner`, added to this package's devDependencies so the real
 * derivation runs here rather than a re-implementation.
 */
import { describe, it, expect } from "vitest";

import { periodMsFromCron } from "../../../harness/src/fleet/control-plane/run-view";
import { isFamilySilent } from "./worker-runs-context";
import type { WorkerFamilySummary } from "./ops-api";

const now = Date.now();

function entryFor(cron: string): WorkerFamilySummary {
  return {
    family: "d5",
    label: "D5 e2e-deep",
    probeKeyPrefix: "d5-single-pill-e2e",
    schedule: cron,
    periodMs: periodMsFromCron(cron), // DERIVED from the cron, never hardcoded
    nextRunAt: null,
    lastRun: null,
    inflight: null,
    lastSuccessAt: new Date(now - 31 * 60_000).toISOString(), // ~31 min stale
  };
}

describe("D5 cadence banner threshold (real periodMsFromCron + isFamilySilent)", () => {
  it("derives periodMs from the cron server-side (the input to the banner threshold)", () => {
    expect(periodMsFromCron("5,20,35,50 * * * *")).toBe(900_000);
    expect(periodMsFromCron("*/30 * * * *")).toBe(1_800_000);
  });

  it("a 31-min-stale d5 family on the 15-min cron IS silent (banner fires)", () => {
    expect(isFamilySilent(entryFor("5,20,35,50 * * * *"), now, null)).toBe(
      true,
    );
  });

  it("the SAME 31-min-stale family on the 30-min cron is NOT silent (banner stays clear)", () => {
    expect(isFamilySilent(entryFor("*/30 * * * *"), now, null)).toBe(false);
  });
});
