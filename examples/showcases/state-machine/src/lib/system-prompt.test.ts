import { describe, expect, test } from "vitest";

import { stageInstructions } from "./system-prompt";

describe("stageInstructions", () => {
  test("ends the build-car instruction after its final complete sentence", () => {
    expect(stageInstructions.buildCar).toMatch(/just show them\.$/);
  });
});
