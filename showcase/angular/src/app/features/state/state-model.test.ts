import { describe, expect, it } from "vitest";

import {
  INITIAL_PREFERENCES,
  INITIAL_RECIPE,
  readDocumentState,
  readRecipeState,
  readWriteState,
  toggleValue,
} from "./state-model";

describe("Angular shared-state demo models", () => {
  it("falls back safely when a backend sends malformed state", () => {
    expect(readWriteState({ preferences: null, notes: "invalid" })).toEqual({
      preferences: INITIAL_PREFERENCES,
      notes: [],
    });
    expect(readRecipeState({ recipe: { title: 42 } })).toEqual(INITIAL_RECIPE);
    expect(readDocumentState({ document: 42 })).toBe("");
  });

  it("preserves valid state restored from the agent", () => {
    const restored = {
      preferences: {
        name: "Jamie",
        tone: "playful",
        language: "Japanese",
        interests: ["Music"],
      },
      notes: ["Prefers concise answers"],
    } as const;

    expect(readWriteState(restored)).toEqual(restored);
    expect(readDocumentState({ document: "Restored draft" })).toBe(
      "Restored draft",
    );
  });

  it("toggles list values immutably", () => {
    const original = ["Cooking"];
    expect(toggleValue(original, "Travel")).toEqual(["Cooking", "Travel"]);
    expect(toggleValue(original, "Cooking")).toEqual([]);
    expect(original).toEqual(["Cooking"]);
  });
});
