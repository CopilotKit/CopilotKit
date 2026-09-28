import { expect, test } from "vitest";
import { clampSize } from "../context-helpers.js";

test("window sizing fits a phone viewport even when desktop minimums are larger", () => {
  expect(
    clampSize(
      { width: 960, height: 740 },
      { width: 390, height: 844 },
      16,
      880,
      480,
    ),
  ).toEqual({ width: 358, height: 740 });
  expect(
    clampSize(
      { width: 960, height: 740 },
      { width: 844, height: 390 },
      16,
      880,
      480,
    ),
  ).toEqual({ width: 812, height: 358 });
});

test("window sizing keeps desktop minimums and caps oversized saved dimensions", () => {
  expect(
    clampSize(
      { width: 300, height: 200 },
      { width: 1440, height: 1000 },
      16,
      880,
      480,
    ),
  ).toEqual({ width: 880, height: 480 });
  expect(
    clampSize(
      { width: 960, height: 740 },
      { width: 1440, height: 1000 },
      16,
      880,
      480,
    ),
  ).toEqual({ width: 960, height: 740 });
  expect(
    clampSize(
      { width: 2200, height: 1600 },
      { width: 1440, height: 1000 },
      16,
      880,
      480,
    ),
  ).toEqual({ width: 1408, height: 968 });
});

test("docked sizing can fill a narrow viewport and tiny viewports never yield negative sizes", () => {
  expect(
    clampSize(
      { width: 720, height: 740 },
      { width: 390, height: 844 },
      0,
      640,
      480,
    ),
  ).toEqual({ width: 390, height: 740 });
  expect(
    clampSize(
      { width: 960, height: 740 },
      { width: 20, height: 20 },
      16,
      880,
      480,
    ),
  ).toEqual({ width: 1, height: 1 });
});
