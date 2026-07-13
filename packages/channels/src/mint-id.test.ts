import { describe, it, expect } from "vitest";
import { mintId, stableStringify } from "./mint-id.js";

describe("mintId", () => {
  it("is content-stable for same component/path/props", () => {
    const a = mintId("Flight", [0, "onClick"], { id: "f1" });
    const b = mintId("Flight", [0, "onClick"], { id: "f1" });
    expect(a).toBe(b);
    expect(a.startsWith("ck:")).toBe(true);
  });
  it("differs when props differ", () => {
    expect(mintId("Flight", [0], { id: "f1" })).not.toBe(
      mintId("Flight", [0], { id: "f2" }),
    );
  });
  it("stableStringify sorts keys", () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(
      stableStringify({ a: 2, b: 1 }),
    );
  });
});
