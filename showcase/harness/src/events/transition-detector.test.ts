import { describe, it, expect } from "vitest";
import { detectTransition } from "./transition-detector.js";
import type { ProbeState, State, Transition } from "../types/index.js";

const PREVS: (State | null)[] = [null, "green", "red", "degraded"];
const NEXTS: ProbeState[] = ["green", "red", "degraded", "error"];

const TABLE: Record<string, Transition> = {
  "null|green": "first",
  "null|red": "first",
  "null|degraded": "first",
  "null|error": "error",
  "green|green": "sustained_green",
  "green|red": "green_to_red",
  "green|degraded": "green_to_red",
  "green|error": "error",
  "red|green": "red_to_green",
  "red|red": "sustained_red",
  "red|degraded": "sustained_red",
  "red|error": "error",
  "degraded|green": "red_to_green",
  "degraded|red": "sustained_red",
  "degraded|degraded": "sustained_red",
  "degraded|error": "error",
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
