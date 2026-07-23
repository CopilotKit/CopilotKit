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

/**
 * The browser driver KINDS the worker registry hosts — one per per-service
 * driver family. These are the `payload.driverKind` keys the producer stamps
 * and the worker's `DriverRegistry` routes on. Kept in lock-step with the
 * `kind` each driver factory reports (`createE2eFullDriver().kind === "e2e_d6"`,
 * etc. in `probes/drivers/*`).
 *
 * `E2E_DRIVER_KINDS` is the closed set; `DriverKind` is its union type. The
 * `E2E_*_DRIVER_KIND` constants below are each typed `DriverKind` (not widened to
 * `string`) so the registry map's key type stays the closed union. NOTE: this is
 * the WORKER-INTERNAL kind space — `contracts.ts`'s `driverKind: string` stays a
 * `string` (it's the wire boundary that receives external producer strings; the
 * runtime unknown-kind guard handles anything off this set).
 *
 * D5 is NOT a separate kind: the D5 ("take-one") probe runs the `e2e_d6` driver,
 * differentiated only by its `driverInputs` (`representativeOnly` + `rowPrefix`).
 * So `e2e_deep` was removed from this closed set when the separate D5 driver was
 * deleted.
 */
export const E2E_DRIVER_KINDS = ["e2e_d6", "e2e_demos", "e2e_smoke"] as const;
export type DriverKind = (typeof E2E_DRIVER_KINDS)[number];

export const E2E_D6_DRIVER_KIND: DriverKind = "e2e_d6";
export const E2E_DEMOS_DRIVER_KIND: DriverKind = "e2e_demos";
export const E2E_SMOKE_DRIVER_KIND: DriverKind = "e2e_smoke";

/**
 * Build a per-service `PayloadToDriverInput` mapping. Re-hydrates the serialized
 * driver input from `payload.driverInputs`, defaulting `key` to the payload's
 * `probeKey`. This re-hydration is IDENTICAL across the three browser driver
 * families (e2e_d6/e2e_demos/e2e_smoke): each driver serializes a
 * `{ key, backendUrl, … }`-shaped
 * object into `driverInputs`, and each driver's OWN zod schema is the validation
 * gate inside `driver.run` (a malformed input fails LOUD there, surfaced by the
 * loop as a terminal result). So one shared mapper serves every kind — every
 * registry entry wires THIS factory directly. Pure; the returned function
 * captures nothing mutable.
 */
export function createPayloadToInput(): PayloadToDriverInput {
  return (payload: ServiceJobPayload): unknown | undefined => {
    const raw = payload.driverInputs;
    // No driver inputs → nothing the driver can run. Signal "unmappable" so the
    // loop reports a protocol violation instead of handing the driver an input
    // its schema will reject deep inside the run.
    if (raw === undefined || raw === null || typeof raw !== "object") {
      return undefined;
    }
    const input = { ...(raw as Record<string, unknown>) };
    // The driver schemas REQUIRE a non-empty `key`. The producer normally stamps
    // it; default to the payload's probeKey (the join key to the dashboard
    // row) so a producer that omitted it still yields a runnable input.
    if (typeof input.key !== "string" || input.key.length === 0) {
      input.key = payload.probeKey;
    }
    return input;
  };
}

/**
 * The d6 (`e2e_d6`) payload→input mapper. Alias of {@link createPayloadToInput}
 * — retained as the original named export so existing call sites keep working.
 */
export const createD6PayloadToInput = createPayloadToInput;
