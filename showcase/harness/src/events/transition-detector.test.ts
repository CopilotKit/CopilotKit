import { describe, it, expect } from "vitest";
import { detectTransition } from "./transition-detector.js";
import type { ProbeState, State, Transition } from "../types/index.js";

const PREVS: (State | null)[] = [null, "green", "red", "degraded", "unknown"];
const NEXTS: ProbeState[] = ["green", "red", "degraded", "error", "unknown"];

// A `next === "unknown"` (the neutral "no-evidence" state) ALWAYS maps to
// the neutral `cleared` transition, regardless of prior world-state. That
// transition is deliberately NOT a member of StringTriggerEnum (schema.ts),
// so no rule can declare it and a green→unknown / red→unknown move fires no
// alert (no spurious green-recovery, no red). A prior `unknown` world-state
// is treated as neutral too: unknown→green is a `first`-like re-observation
// (we never observed a real green/red baseline before the no-evidence gap),
// and unknown→red/degraded is `first` (the failure baseline starts now).
const TABLE: Record<string, Transition> = {
  "null|green": "first",
  "null|red": "first",
  "null|degraded": "first",
  "null|error": "error",
  "null|unknown": "cleared",
  "green|green": "sustained_green",
  "green|red": "green_to_red",
  "green|degraded": "green_to_red",
  "green|error": "error",
  "green|unknown": "cleared",
  "red|green": "red_to_green",
  "red|red": "sustained_red",
  "red|degraded": "sustained_red",
  "red|error": "error",
  "red|unknown": "cleared",
  "degraded|green": "red_to_green",
  "degraded|red": "sustained_red",
  "degraded|degraded": "sustained_red",
  "degraded|error": "error",
  "degraded|unknown": "cleared",
  "unknown|green": "first",
  "unknown|red": "first",
  "unknown|degraded": "first",
  "unknown|error": "error",
  "unknown|unknown": "cleared",
};

describe("transition-detector", () => {
  for (const prev of PREVS) {
    for (const next of NEXTS) {
      const key = `${prev ?? "null"}|${next}`;
      it(`${key} -> ${TABLE[key]}`, () => {
        expect(detectTransition(prev, next)).toBe(TABLE[key]);
      });
    }
  }
});
