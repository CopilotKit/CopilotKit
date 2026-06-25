/**
 * emit-perf.bench.ts — CI perf-regression gate for `CvdiagEmitter` emit cost
 * (plan unit L2-D). Pure instrumentation must stay cheap on the boundary it
 * observes: spec §7 sets a 500µs/event PROD budget; this gate holds emit at
 * 50% of that for headroom — median ≤100µs, p99 ≤250µs per event — and fails
 * the job if either metric regresses past those thresholds (×1.2 = >20% over).
 *
 * What is measured: the full hot path of `CvdiagEmitter.emit()` — closed-world
 * metadata validation, envelope construction (id/span minting + ISO ts +
 * mono_ns), defense-in-depth envelope validation, byte-cap serialization
 * (JSON.stringify), and bounded-queue enqueue — for 1000 events per pass. We
 * drain the queue each pass so the bench measures steady-state construct +
 * serialize + enqueue cost rather than drop-oldest eviction once the queue
 * passes QUEUE_CAP.
 *
 * How the gate fires: vitest `bench` does NOT run `afterAll`/test-style
 * assertions, so a percentile assertion there would silently no-op. Instead the
 * bench body times each individual emit with `performance.now()` and pushes the
 * per-event µs into a module-level sample; the bench task's `teardown` (which
 * DOES run after the timed passes, with a real effect on the process exit code)
 * computes the true per-event median/p99 over that sample and THROWS on a
 * breach — failing the suite, the `vitest bench` exit code, and therefore the
 * CI job. The tinybench hz/p99 table this file also emits is the human-readable
 * companion; the throw is the actual regression gate.
 *
 * Run locally:
 *   cd showcase/harness && npx vitest bench src/cvdiag/emit-perf.bench.ts
 *
 * Spec: 2026-06-18-flap-observability.md §7 (per-event perf budget).
 */

import { bench, describe } from "vitest";

import { CvdiagEmitter } from "./emit.js";
import type { CvdiagEmitArgs } from "./emit.js";

/** Per-event budget (spec §7: 50% of the 500µs prod budget for headroom). */
const MEDIAN_BUDGET_US = 100;
const P99_BUDGET_US = 250;
/** A regression past 1.2× the budget reds the gate (>20% over threshold). */
const REGRESSION_FACTOR = 1.2;
const MEDIAN_CEILING_US = MEDIAN_BUDGET_US * REGRESSION_FACTOR;
const P99_CEILING_US = P99_BUDGET_US * REGRESSION_FACTOR;

/** Events emitted per measured pass. */
const EVENTS_PER_PASS = 1000;

/**
 * A representative default-tier data-plane boundary. `probe.message.send` is
 * emitted at every tier and carries a small closed-world metadata bag
 * (message_index / char_count / demo), so it exercises metadata validation and
 * serialization without inflating the envelope past the default byte cap.
 */
function makeArgs(i: number): CvdiagEmitArgs {
  return {
    layer: "probe",
    boundary: "probe.message.send",
    slug: "perf-bench",
    demo: "perf-bench",
    outcome: "ok",
    metadata: {
      message_index: i,
      char_count: 128,
      demo: "perf-bench",
    },
  };
}

/** Pre-size the args once; the bench measures emit, not arg construction. */
const ARGS: CvdiagEmitArgs[] = Array.from({ length: EVENTS_PER_PASS }, (_, i) =>
  makeArgs(i),
);

/**
 * Per-event durations (µs) accumulated across every timed pass. tinybench runs
 * the body many times within its time budget, so this grows well past one pass
 * and yields a robust p99. The `teardown` reads it to gate.
 */
const perEventUs: number[] = [];

/**
 * Compute a percentile (0..100) from an ASCENDING-sorted sample of per-event
 * durations (µs) via nearest-rank, so p99 of N samples is a real observed
 * value rather than an interpolated one.
 */
function percentile(sortedUs: number[], p: number): number {
  if (sortedUs.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sortedUs.length);
  const idx = Math.min(Math.max(rank - 1, 0), sortedUs.length - 1);
  return sortedUs[idx];
}

describe("CvdiagEmitter emit cost", () => {
  // A fresh emitter per pass; drain the queue at the end of each pass so
  // steady-state cost (construct + serialize + enqueue) is measured rather
  // than drop-oldest overflow churn once QUEUE_CAP is exceeded.
  let emitter: CvdiagEmitter;

  bench(
    `emit ${EVENTS_PER_PASS} events (median ≤${MEDIAN_BUDGET_US}µs / p99 ≤${P99_BUDGET_US}µs per event)`,
    () => {
      for (let i = 0; i < EVENTS_PER_PASS; i += 1) {
        const start = performance.now();
        emitter.emit(ARGS[i]);
        const end = performance.now();
        // performance.now() is ms with sub-ms precision → ×1000 for µs.
        perEventUs.push((end - start) * 1000);
      }
      // Drain so the next pass starts from an empty queue (steady state).
      void emitter.flush();
    },
    {
      time: 500,
      warmupIterations: 5,
      setup: () => {
        emitter = new CvdiagEmitter({
          // VERBOSE keeps probe.message.send in the matrix without DEBUG's
          // prod-fail-closed startup guard; no pbWriter, so events stay queued.
          verbose: true,
          layer: "probe",
          env: { NODE_ENV: "test" },
        });
      },
      // The actual CI gate. `teardown` runs AFTER the timed passes and its
      // throw propagates to the suite + process exit code (verified: vitest
      // `bench` ignores afterAll/assertions but honors a teardown throw).
      teardown: () => {
        const sorted = [...perEventUs].sort((a, b) => a - b);
        const medianUs = percentile(sorted, 50);
        const p99Us = percentile(sorted, 99);

        // eslint-disable-next-line no-console
        console.log(
          `[cvdiag-perf] samples=${sorted.length} ` +
            `per-event median=${medianUs.toFixed(2)}µs p99=${p99Us.toFixed(2)}µs ` +
            `(budget median≤${MEDIAN_BUDGET_US}µs ceiling≤${MEDIAN_CEILING_US}µs, ` +
            `p99≤${P99_BUDGET_US}µs ceiling≤${P99_CEILING_US}µs)`,
        );

        if (sorted.length === 0) {
          throw new Error(
            "[cvdiag-perf] no per-event samples were recorded — the bench body did not run",
          );
        }
        const breaches: string[] = [];
        if (medianUs > MEDIAN_CEILING_US) {
          breaches.push(
            `per-event median ${medianUs.toFixed(2)}µs exceeds the ` +
              `${MEDIAN_CEILING_US}µs regression ceiling (budget ${MEDIAN_BUDGET_US}µs +20%)`,
          );
        }
        if (p99Us > P99_CEILING_US) {
          breaches.push(
            `per-event p99 ${p99Us.toFixed(2)}µs exceeds the ` +
              `${P99_CEILING_US}µs regression ceiling (budget ${P99_BUDGET_US}µs +20%)`,
          );
        }
        if (breaches.length > 0) {
          throw new Error(
            `[cvdiag-perf] emit cost regressed: ${breaches.join("; ")}`,
          );
        }
      },
    },
  );
});
