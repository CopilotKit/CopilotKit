/**
 * Worker payload → d6 driver-input mapper (the catalog-aware seam S7's
 * `PayloadToDriverInput` types against).
 *
 * ── WHY THIS LIVES HERE, NOT IN worker-loop.ts ─────────────────────────────
 * The worker loop (S7) types its driver-input construction against the
 * `PayloadToDriverInput` interface and INJECTS the concrete mapping, precisely
 * so the loop never learns the d6 driver's input shape. This module is that
 * concrete mapping for the d6 (`e2e_d6`) per-service unit: it re-hydrates the
 * `E2eFullDriverInput` object the d6 driver's zod schema validates
 * (`key`/`backendUrl`/`demos`/`shape`/…) from the claimed `ServiceJobPayload`.
 *
 * ── WHERE THE INPUT COMES FROM ─────────────────────────────────────────────
 * The control-plane PRODUCER (S4) is the catalog-aware side: its enumerator
 * resolves each showcase service (Railway discovery → backendUrl, declared
 * demos, manifest `not_supported_features`, shape) and serializes that object
 * into `payload.driverInputs`. So the worker side is a thin re-hydration: take
 * `driverInputs` as the d6 input, and default the `key` to the payload's
 * `probeKey` when the producer didn't stamp one (the d6 schema requires `key`).
 * The d6 driver's own zod schema is the validation gate — a malformed input
 * fails LOUD inside `driver.run`, surfaced by the loop as a terminal result.
 *
 * Returning `undefined` signals "this payload can't be mapped" → the loop
 * reports a `worker-protocol-violation` terminal result rather than crashing.
 * We return `undefined` ONLY when the producer attached no `driverInputs` at
 * all (there's nothing to run); a present-but-incomplete input is forwarded so
 * the d6 schema produces the precise validation error.
 */

import type { PayloadToDriverInput } from "./worker-loop.js";
import type { ServiceJobPayload } from "../contracts.js";

/** The driver kind this mapper knows how to map. */
export const E2E_D6_DRIVER_KIND = "e2e_d6";

/**
 * Build the d6 `PayloadToDriverInput` mapping. Re-hydrates the serialized d6
 * input from `payload.driverInputs`, defaulting `key` to the payload's
 * `probeKey`. Pure; the returned function captures nothing mutable.
 */
export function createD6PayloadToInput(): PayloadToDriverInput {
  return (payload: ServiceJobPayload): unknown | undefined => {
    const raw = payload.driverInputs;
    // No driver inputs → nothing the d6 driver can run. Signal "unmappable" so
    // the loop reports a protocol violation instead of handing the driver an
    // input its schema will reject deep inside the run.
    if (raw === undefined || raw === null || typeof raw !== "object") {
      return undefined;
    }
    const input = { ...(raw as Record<string, unknown>) };
    // The d6 schema REQUIRES a non-empty `key`. The producer normally stamps
    // it; default to the payload's probeKey (the join key to the dashboard
    // row) so a producer that omitted it still yields a runnable input.
    if (typeof input.key !== "string" || input.key.length === 0) {
      input.key = payload.probeKey;
    }
    return input;
  };
}
