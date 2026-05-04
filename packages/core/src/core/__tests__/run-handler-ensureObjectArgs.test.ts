import { describe, it, expect } from "vitest";
import { ensureObjectArgs } from "../run-handler";

describe("ensureObjectArgs", () => {
  it("returns a valid plain object unchanged", () => {
    const input = { key: "value", nested: { a: 1 } };
    expect(ensureObjectArgs(input, "testTool")).toEqual(input);
  });

  it("returns an empty object unchanged", () => {
    expect(ensureObjectArgs({}, "testTool")).toEqual({});
  });

  it("throws for a string", () => {
    expect(() => ensureObjectArgs("hello", "testTool")).toThrow(
      "Tool arguments for testTool parsed to non-object (string)",
    );
  });

  it("throws for a number", () => {
    expect(() => ensureObjectArgs(42, "testTool")).toThrow(
      "Tool arguments for testTool parsed to non-object (number)",
    );
  });

  it("throws for an array", () => {
    expect(() => ensureObjectArgs([1, 2, 3], "testTool")).toThrow(
      "Tool arguments for testTool parsed to non-object (object)",
    );
  });

  it("throws for null", () => {
    expect(() => ensureObjectArgs(null, "testTool")).toThrow(
      "Tool arguments for testTool parsed to non-object (object)",
    );
  });

  it("throws for a boolean", () => {
    expect(() => ensureObjectArgs(true, "testTool")).toThrow(
      "Tool arguments for testTool parsed to non-object (boolean)",
    );
  });

  it("throws for undefined", () => {
    expect(() => ensureObjectArgs(undefined, "testTool")).toThrow(
      "Tool arguments for testTool parsed to non-object (undefined)",
    );
  });
});
