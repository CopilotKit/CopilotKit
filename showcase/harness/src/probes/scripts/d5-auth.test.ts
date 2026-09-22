import { describe, it, expect } from "vitest";
import { buildTurns } from "./d5-auth.js";
import { getD5Script } from "../helpers/d5-registry.js";

describe("auth canonical functional contract", () => {
  it("registers the canonical builder", () => {
    expect(getD5Script("auth")?.buildTurns).toBe(buildTurns);
  });
  it("fails explicitly when LGP has no authored pill", () => {
    expect(() => buildTurns()).toThrow(/NO_AUTHORED_CANONICAL_PILL/);
  });
});
