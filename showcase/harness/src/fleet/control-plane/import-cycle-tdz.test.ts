/**
 * Regression guard for the fleet control-plane import cycle TDZ crash.
 *
 * The cycle is control-plane → job-producer → run-view → control-plane. The
 * §5.1 family registry (`run-view.ts`'s top-level `FLEET_FAMILIES` literal)
 * reads the producer schedule ids at MODULE-EVAL time. When those ids lived in
 * `control-plane.ts` (inside the cycle), one load order — entering the graph
 * via `control-plane.js` FIRST, exactly as `http/fleet-runs.ts` does —
 * evaluated `FLEET_FAMILIES` before `control-plane.ts` finished its top-level
 * assignments, throwing `ReferenceError: Cannot access
 * 'FLEET_PRODUCER_SCHEDULE_ID' before initialization` and crash-looping the
 * harness on boot. The fix homes the ids in the cycle-free leaf
 * `schedule-ids.ts`, so the literal can never read them in the TDZ.
 *
 * These tests reproduce the exact boot load order with a fresh module registry
 * (so the dynamic import actually re-evaluates the graph) and assert the
 * module graph loads without throwing, and that the ids are wired through.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

describe("fleet control-plane import cycle (TDZ regression)", () => {
  beforeEach(() => {
    // Force a fresh module registry so each dynamic import re-evaluates the
    // module graph from scratch — otherwise a prior import would have already
    // initialized the constants and masked the eval-time ordering.
    vi.resetModules();
  });

  it("loads the graph entering via control-plane.js FIRST (the fleet-runs / boot order) without a TDZ ReferenceError", async () => {
    // Importing control-plane.js first triggers its transitive
    // job-producer → run-view evaluation, which is where the FLEET_FAMILIES
    // literal used to hit the dead zone. No throw == cycle broken.
    await expect(import("./control-plane.js")).resolves.toBeDefined();
    await expect(import("./run-view.js")).resolves.toBeDefined();
  });

  it("loads the graph entering via run-view.js first without a TDZ ReferenceError", async () => {
    await expect(import("./run-view.js")).resolves.toBeDefined();
    await expect(import("./control-plane.js")).resolves.toBeDefined();
  });

  it("wires the schedule ids through both the leaf and control-plane re-export", async () => {
    const leaf = await import("./schedule-ids.js");
    const cp = await import("./control-plane.js");
    const rv = await import("./run-view.js");

    expect(leaf.FLEET_PRODUCER_SCHEDULE_ID).toBe("fleet-job-producer");
    // control-plane re-exports the leaf values (its public surface is unchanged).
    expect(cp.FLEET_PRODUCER_SCHEDULE_ID).toBe(leaf.FLEET_PRODUCER_SCHEDULE_ID);
    expect(cp.FLEET_PRODUCER_SMOKE_SCHEDULE_ID).toBe(
      leaf.FLEET_PRODUCER_SMOKE_SCHEDULE_ID,
    );
    expect(cp.FLEET_PRODUCER_DEMOS_SCHEDULE_ID).toBe(
      leaf.FLEET_PRODUCER_DEMOS_SCHEDULE_ID,
    );
    expect(cp.FLEET_PRODUCER_DEEP_SCHEDULE_ID).toBe(
      leaf.FLEET_PRODUCER_DEEP_SCHEDULE_ID,
    );
    // The §5.1 family registry read the (now leaf-homed) ids at eval time.
    const d6 = rv.FLEET_FAMILIES.find((f) => f.family === "d6");
    expect(d6?.scheduleId).toBe(leaf.FLEET_PRODUCER_SCHEDULE_ID);
  });
});
