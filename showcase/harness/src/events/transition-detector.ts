import type { ProbeState, State, Transition } from "../types/index.js";

/**
 * Pure state-machine transition detector. No side effects.
 *
 * prev: the last known *world state* (3-valued: green/red/degraded) or null.
 * next: the probe result's state (4-valued: adds "error").
 *
 * Transition table (row = prev, col = next):
 *   |          | green            | red              | degraded         | error   | unknown |
 *   |----------|------------------|------------------|------------------|---------|---------|
 *   | null     | first            | first            | first            | error   | cleared |
 *   | green    | sustained_green  | green_to_red     | green_to_red     | error   | cleared |
 *   | red      | red_to_green     | sustained_red    | sustained_red    | error   | cleared |
 *   | degraded | red_to_green     | sustained_red    | sustained_red    | error   | cleared |
 *   | unknown  | first            | first            | first            | error   | cleared |
 *
 * Design decisions:
 *
 * - `unknown` is the NEUTRAL "no-evidence" state and ALWAYS yields `cleared`,
 *   regardless of prior world-state. `cleared` is deliberately not in the
 *   rule trigger vocabulary (StringTriggerEnum), so a green→unknown move
 *   fires no spurious green-recovery and a red→unknown move fires no
 *   spurious red_to_green. The status-writer SUCCESS path still OVERWRITES
 *   the persisted state to `unknown` (resetting fail_count) — so the cell
 *   loses its green colour even though no alert is emitted.
 *
 * - `unknown` as PRIOR state behaves like `null`: there is no trustworthy
 *   green/red baseline, so the next real green/red/degraded observation is
 *   `first` (not red_to_green / green_to_red). A no-evidence gap must not
 *   manufacture a recovery or regression transition out of thin air.
 *
 * - `error` dominates a non-unknown `prev`: once a probe reports error, the
 *   transition is always `error` regardless of prior world-state. This keeps
 *   the onError dispatch path orthogonal to the normal green/red machine.
 *   Alert-engine applies its own bootstrap gate on onError so a prev=null →
 *   error transition is still suppressed during the bootstrap window. (When
 *   `next === "unknown"` we short-circuit to `cleared` BEFORE the error
 *   check — but `next` is never both, so ordering is immaterial here.)
 *
 * - `degraded` collapses into `red` for transition-naming (spec §2 — "red
 *   dominates"). No `green_to_degraded` / `degraded_to_green` etc. — any
 *   cross-family move is `green_to_red` / `red_to_green`, and within-family
 *   shifts surface as `sustained_red`. The 3-valued world-state is retained
 *   so UI cells can render amber distinctly; trigger names stay 2-valued.
 *
 * - There is deliberately no `first_observation` transition distinct from
 *   `first`. Every first-ever record maps to `first`, and alert-engine's
 *   bootstrap-window gate plus the explicit `isFreshRed` check in
 *   handleStatusChanged already dedupe fresh-boot noise. Introducing a
 *   separate kind would force every rule to enumerate both (or confuse
 *   authors who omit one). See types/index.ts `Transition` for the
 *   authoritative closed set.
 */
export function detectTransition(
  prev: State | null,
  next: ProbeState,
): Transition {
  // Neutral no-evidence next-state: always `cleared`, never an alert-bearing
  // transition. Checked first so it dominates every prior world-state.
  if (next === "unknown") return "cleared";
  if (next === "error") return "error";
  // A prior `unknown` carries no trustworthy baseline (same as null), so the
  // next real observation is `first` rather than a synthesized recovery /
  // regression.
  if (prev === null || prev === "unknown") return "first";
  const prevRed = prev === "red" || prev === "degraded";
  const nextRed = next === "red" || next === "degraded";
  if (!prevRed && nextRed) return "green_to_red";
  if (prevRed && !nextRed) return "red_to_green";
  if (prevRed && nextRed) return "sustained_red";
  return "sustained_green";
}
