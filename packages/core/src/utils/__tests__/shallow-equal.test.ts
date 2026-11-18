import { describe, expect, it } from "vitest";
import { shallowEqualRecord } from "../shallow-equal";

describe("shallowEqualRecord", () => {
  it("is true for the same keys holding the same values, in any order", () => {
    const shared = { nested: true };

    expect(shallowEqualRecord({ a: 1, b: shared }, { b: shared, a: 1 })).toBe(
      true,
    );
  });

  it("compares nested objects by reference", () => {
    expect(shallowEqualRecord({ a: { x: 1 } }, { a: { x: 1 } })).toBe(false);
  });

  it("is false when the key count differs", () => {
    expect(shallowEqualRecord({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });

  it("is false for different keys that both hold undefined", () => {
    expect(shallowEqualRecord({ a: undefined }, { b: undefined })).toBe(false);
  });

  it("treats NaN as equal to NaN and +0 as different from -0", () => {
    expect(shallowEqualRecord({ a: NaN }, { a: NaN })).toBe(true);
    expect(shallowEqualRecord({ a: 0 }, { a: -0 })).toBe(false);
  });
});
