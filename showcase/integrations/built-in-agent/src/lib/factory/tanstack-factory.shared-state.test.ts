import { describe, expect, it } from "vitest";
import { formatSharedStatePreferences } from "./tanstack-factory";

describe("formatSharedStatePreferences", () => {
  it("serializes the shared-state preferences that must steer the model", () => {
    expect(
      formatSharedStatePreferences({
        state: {
          preferences: {
            name: "Avery",
            tone: "playful",
            language: "Spanish",
            interests: ["Cooking", "Travel"],
          },
        },
      }),
    ).toContain("- Interests: Cooking, Travel");
  });

  it("keeps the initial UI preferences explicit", () => {
    expect(
      formatSharedStatePreferences({
        state: {
          preferences: {
            name: "",
            tone: "casual",
            language: "English",
            interests: [],
          },
        },
      }),
    ).toContain("- Tone: casual");
  });

  it("does not add a prompt when this demo's preference state is absent", () => {
    expect(formatSharedStatePreferences({ state: {} })).toBeUndefined();
  });
});
