"use client";

/**
 * Aeronova's runtime `properties` — the CLIENT half of per-user Intelligence
 * scoping. The shell calls this inside `RuntimeProviders` (above
 * `CopilotKitProvider`) and threads the result straight into the provider's
 * `properties` prop, so it arrives at the runtime as the run body's
 * `forwardedProps` and reaches `airlineIdentifyUser`
 * (`intelligence/user-id.ts`) on the server.
 *
 * ── WHY THERE IS NO `RuntimeProviders` FOR THIS ─────────────────────────────
 * Banking, people and commerce each hoist a context above `CopilotKitProvider`
 * because their identity is a CHOICE the operator makes in the sidebar, so the
 * hook has to read state. Aeronova has no switcher and cannot have one without
 * becoming the agency console `pages/account.tsx` exists to prevent: there is one
 * account, and the person using the app is its holder. So this hook reads no
 * context, needs nothing mounted above the provider, and returns a module-scope
 * FROZEN constant.
 *
 * A frozen module constant, not an object literal: the contract asks for a
 * stable/memoized object because `CopilotKitProvider` owns the property bag from
 * its first commit, and a fresh literal each render is a new identity on every
 * pass. `Object.freeze` is belt-and-braces — the value is shared by every consumer
 * and nothing should be able to mutate it out from under the provider.
 *
 * ⚠️ `userId` IS A TRAVELLER ID, not a memory bucket name. The mapping from one to
 * the other lives entirely in `intelligence/user-id.ts`, server-side, because the
 * bucket name is not the browser's business and a client-supplied bucket would let
 * anyone read anyone's memories. `runtime-properties.test.ts` pins that this
 * literal is the account holder's id in `data/trip-seed.ts` — the id is duplicated
 * here rather than imported so the seed's 43-row option grid stays out of the
 * client bundle, and that test is the drift guard the duplication needs.
 */

/** Camila's traveller id in `data/trip-seed.ts`. See the note above. */
export const AIRLINE_RUNTIME_USER_ID = "tv-camila";

/** Matches `PASSENGER_ROLE` in `intelligence/user-id.ts`, pinned by the same test. */
export const AIRLINE_RUNTIME_USER_ROLE = "passenger";

const AIRLINE_RUNTIME_PROPERTIES: Readonly<Record<string, unknown>> =
  Object.freeze({
    userId: AIRLINE_RUNTIME_USER_ID,
    userRole: AIRLINE_RUNTIME_USER_ROLE,
  });

export function useAirlineRuntimeProperties(): Record<string, unknown> {
  return AIRLINE_RUNTIME_PROPERTIES;
}
