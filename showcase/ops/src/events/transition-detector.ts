import type { ProbeState, State, Transition } from "../types/index.js";

/**
 * Pure state-machine transition detector. No side effects.
 *
 * prev: the last known *world state* (3-valued: green/red/degraded) or null.
 * next: the probe result's state (4-valued: adds "error").
 *
 * Rules:
 * - next === "error"             -> "error" (world-state carries forward)
 * - prev === null                -> "first"
 * - prev green, next red/degraded -> "green_to_red"
 * - prev red/degraded, next green -> "red_to_green"
 * - both red/degraded            -> "sustained_red"
 * - both green                   -> "sustained_green"
 *
 * State-design decision (spec §2 — "red dominates"): `degraded` is collapsed
 * into `red` for transition-naming purposes. There are no
 * `green_to_degraded` / `degraded_to_green` / `degraded_to_red` /
 * `red_to_degraded` transitions — any move between red-family states (red,
 * degraded) that starts or ends in green uses `green_to_red` /
 * `red_to_green`, and within-red-family transitions surface as
 * `sustained_red`. See types/index.ts `Transition` union for the authoritative
 * closed set of transition names. The 3-valued world-state is retained so
 * UI cells can render amber (degraded) distinctly, but the alert engine's
 * trigger names are 2-valued.
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
