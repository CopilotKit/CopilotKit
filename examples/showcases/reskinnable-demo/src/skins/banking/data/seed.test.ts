import { describe, expect, it } from "vitest";
import seed from "./seed.json";

describe("seed team roster", () => {
  it("has exactly the two memory personas, with distinct roles", () => {
    const names = seed.team.map((m) => m.name).sort();
    expect(names).toEqual(["Alex Morgan", "Maya Chen"]);
    const roles = seed.team.map((m) => m.role);
    expect(new Set(roles)).toEqual(new Set(["Admin", "Assistant"]));
  });

  it("keeps the member ids the identity map expects", () => {
    const ids = seed.team.map((m) => m.id).sort();
    expect(ids).toEqual(["2b3c4d5e6f", "9g5h2j1k4l"].sort());
  });
});
