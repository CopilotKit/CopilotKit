import { describe, it, expect } from "vitest";
import { DM_SCOPE } from "../types.js";

describe("types", () => {
  it("exposes the DM scope sentinel", () => {
    expect(DM_SCOPE).toBe("dm");
  });
});
