/**
 * Producer scheduler-entry ids — a LEAF module with NO imports back into
 * `control-plane.ts` / `run-view.ts` / `job-producer.ts`.
 *
 * These four ids are consumed at MODULE-EVAL time by the §5.1 family registry
 * (`run-view.ts`'s top-level `FLEET_FAMILIES` literal) and by the on-demand
 * trigger route (`http/fleet-runs.ts`), while `control-plane.ts` itself sits
 * inside the same `control-plane → job-producer → run-view → control-plane`
 * import cycle. Homing the ids HERE — in a leaf with no edges back into that
 * cycle — guarantees they are fully initialized regardless of the cycle's
 * load order, so no consumer can hit them in the temporal dead zone.
 *
 * (Previously these lived in `control-plane.ts`; under one load order the
 * `FLEET_FAMILIES` literal evaluated before `control-plane.ts` finished its
 * top-level assignments, throwing `ReferenceError: Cannot access
 * 'FLEET_PRODUCER_SCHEDULE_ID' before initialization` and crash-looping the
 * harness on boot. A leaf module removes the eval-time dependency entirely.)
 */

/** Scheduler entry id the d6 producer's tick registers under. */
export const FLEET_PRODUCER_SCHEDULE_ID = "fleet-job-producer";

/**
 * Scheduler entry ids for the three non-d6 browser-family producers. The §5.1
 * family registry (`run-view.ts`) and the on-demand trigger route import all
 * four ids from this cycle-free home. The cron constants stay in
 * `orchestrator.ts` (the registry deliberately carries no cron literals;
 * resolution is runtime).
 */
export const FLEET_PRODUCER_SMOKE_SCHEDULE_ID = "fleet-producer-e2e-smoke";
export const FLEET_PRODUCER_DEMOS_SCHEDULE_ID = "fleet-producer-e2e-demos";
export const FLEET_PRODUCER_DEEP_SCHEDULE_ID = "fleet-producer-e2e-deep";
