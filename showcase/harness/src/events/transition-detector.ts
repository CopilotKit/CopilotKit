import type { ProbeState, State, Transition } from "../types/index.js";

/**
 * Pure state-machine transition detector. No side effects.
 *
 * prev: the last known *world state* (3-valued: green/red/degraded) or null.
 * next: the probe result's state (4-valued: adds "error").
 *
 * Transition table (row = prev, col = next):
 *   |          | green            | red              | degraded         | error   |
 *   |----------|------------------|------------------|------------------|---------|
 *   | null     | first            | first            | first            | error   |
 *   | green    | sustained_green  | green_to_red     | green_to_red     | error   |
 *   | red      | red_to_green     | sustained_red    | sustained_red    | error   |
 *   | degraded | red_to_green     | sustained_red    | sustained_red    | error   |
 *
 * Design decisions:
 *
 * - `error` dominates `prev`: once a probe reports error, the transition is
 *   always `error` regardless of prior world-state. This keeps the onError
 *   dispatch path orthogonal to the normal green/red machine. Alert-engine
 *   applies its own bootstrap gate on onError so a prev=null → error
 *   transition is still suppressed during the bootstrap window.
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
  if (next === "error") return "error";
  if (prev === null) return "first";
  const prevRed = prev === "red" || prev === "degraded";
  const nextRed = next === "red" || next === "degraded";
  if (!prevRed && nextRed) return "green_to_red";
  if (prevRed && !nextRed) return "red_to_green";
  if (prevRed && nextRed) return "sustained_red";
  return "sustained_green";
}
