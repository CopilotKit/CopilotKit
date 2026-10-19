import { describe, expect, it } from "vitest";
import { clampSize } from "./context-helpers.js";

describe("clampSize", () => {
  it("keeps the minimum size when the viewport has room for it", () => {
    expect(
      clampSize(
        { width: 400, height: 300 },
        { width: 1440, height: 900 },
        16,
        880,
        480,
      ),
    ).toEqual({ width: 880, height: 480 });
  });

  it("caps the size at the viewport minus its margins", () => {
    expect(
      clampSize(
        { width: 2000, height: 2000 },
        { width: 1440, height: 900 },
        16,
        880,
        480,
      ),
    ).toEqual({ width: 1408, height: 868 });
  });

  it("lets the viewport win when it is smaller than the minimum", () => {
    expect(
      clampSize(
        { width: 960, height: 740 },
        { width: 380, height: 320 },
        16,
        880,
        480,
      ),
    ).toEqual({ width: 348, height: 288 });
  });
});
