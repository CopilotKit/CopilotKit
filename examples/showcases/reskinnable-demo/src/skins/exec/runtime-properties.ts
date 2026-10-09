"use client";

/**
 * Vantage's runtime `properties` — the CLIENT half of per-user Intelligence
 * scoping. The shell calls this inside `RuntimeProviders` (above
 * `CopilotKitProvider`) and threads the result straight into the provider's
 * `properties` prop, so it arrives at the runtime as the run body's
 * `forwardedProps`.
 *
 * ── WHY THERE IS NO `RuntimeProviders` FOR THIS ─────────────────────────────
 * Banking, people and commerce each hoist a context above `CopilotKitProvider`
 * because their identity is a CHOICE the operator makes in the sidebar, so the
 * hook has to read state. Airline is the worked example for the opposite case
 * (`skins/airline/runtime-properties.ts`): it has one account holder and no
 * switcher, so its hook reads no context and returns a frozen module constant.
 * Exec is the same shape — one persona, the chief of staff, with no switcher
 * — so this hook reads no context either, needs nothing mounted above the
 * provider, and the skin supplies NO `RuntimeProviders`.
 *
 * A frozen module constant, not an object literal: the contract asks for a
 * stable/memoized object because `CopilotKitProvider` owns the property bag
 * from its first commit, and a fresh literal each render is a new identity on
 * every pass. `Object.freeze` is belt-and-braces — the value is shared by
 * every consumer and nothing should be able to mutate it out from under the
 * provider.
 */
const EXEC_RUNTIME_PROPERTIES: Readonly<Record<string, unknown>> =
  Object.freeze({
    userId: "cascade-chief-of-staff",
    userRole: "chief-of-staff",
  });

export function useExecRuntimeProperties():
  | Record<string, unknown>
  | undefined {
  return EXEC_RUNTIME_PROPERTIES;
}
