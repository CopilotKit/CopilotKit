import { describe, it, expect } from "vitest";
import { DIMENSIONS } from "./index.js";

describe("DIMENSIONS", () => {
  it("contains e2e_d6 for the D6 probe kind", () => {
    expect(DIMENSIONS).toContain("e2e_d6");
  });

  it("contains d6 for D6 side-row dimension", () => {
    expect(DIMENSIONS).toContain("d6");
  });
});
