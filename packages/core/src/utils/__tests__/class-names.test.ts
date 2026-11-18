import { describe, expect, it } from "vitest";
import { cn } from "../class-names";

describe("cn", () => {
  it("joins strings and numbers and skips falsy values", () => {
    expect(cn("a", undefined, null, false, "", 0, "b", 3)).toBe("a b 3");
  });

  it("flattens nested arrays", () => {
    expect(cn(["a", ["b", false]], "c")).toBe("a b c");
  });

  it("keeps object keys whose values are truthy", () => {
    expect(cn({ on: true, off: false, also: 1 })).toBe("on also");
  });

  it("does not merge or dedupe classes", () => {
    expect(cn("p-2", "p-4", "p-2")).toBe("p-2 p-4 p-2");
  });
});
