import { z } from "zod";
import {
  aimockWiringProbe,
  type AimockWiringInput,
  type AimockWiringSignal,
} from "../aimock-wiring.js";
import type { ProbeDriver } from "../types.js";

/**
 * Driver wrapper around the legacy `aimockWiringProbe`. The existing probe
 * object (see `../aimock-wiring.ts`) is the single source of truth for probe
 * BEHAVIOUR — this file only adapts the call-order and adds the Zod
 * `inputSchema` the new driver contract requires. Concretely:
 *
 *   1. Legacy `Probe.run(input, ctx)` → new `ProbeDriver.run(ctx, input)`
 *      call-order flip. Every other field on the result is unchanged so the
 *      alert engine and templates that key on `signal.*` keep working
 *      verbatim.
 *   2. `inputSchema` validates the callback-bearing input shape at invoke
 *      time. The schema uses `.passthrough()` on the service-env map and
 *      types the two callbacks as `z.function()` — the probe-invoker wraps
 *      this in a `safeParse` so a mis-wired orchestrator (forgot to pass
 *      `getServiceEnv`) surfaces as a keyed synthetic-error ProbeResult
 *      rather than a runtime TypeError inside the probe.
 *
 * The Phase 4 cleanup (out of scope for this change) removes the legacy
 * `Probe` interface and folds the probe body directly into this file.
 * Until then, keeping the wrapper thin avoids duplicating the ~150-line
 * URL-normalization / env-classification logic during the migration.
 */

/**
 * Input schema for the aimock-wiring driver. Uses `z.custom` for the two
 * callbacks because `z.function()` would narrow them to a zero-arg shape
 * when parsed, losing the `Promise<Record<string, string | undefined>>`
 * return type Typescript otherwise infers. A structural custom check that
 * asserts "is a function" is sufficient — the callback's runtime contract
 * is covered by the probe body's own try/catch around `getServiceEnv`.
 */
const aimockWiringInputSchema = z.object({
  aimockUrl: z.string().min(1),
  listServices: z.custom<AimockWiringInput["listServices"]>(
    (v) => typeof v === "function",
    { message: "listServices must be a callable" },
  ),
  getServiceEnv: z.custom<AimockWiringInput["getServiceEnv"]>(
    (v) => typeof v === "function",
    { message: "getServiceEnv must be a callable" },
  ),
});

export const aimockWiringDriver: ProbeDriver<
  AimockWiringInput,
  AimockWiringSignal
> = {
  kind: aimockWiringProbe.dimension,
  inputSchema: aimockWiringInputSchema,
  async run(ctx, input) {
    // Legacy probe takes `(input, ctx)`. Flipping the argument order here is
    // the entire shim — any behavioural change belongs in the probe body
    // (`../aimock-wiring.ts`), not this wrapper.
    return aimockWiringProbe.run(input, ctx);
  },
};
