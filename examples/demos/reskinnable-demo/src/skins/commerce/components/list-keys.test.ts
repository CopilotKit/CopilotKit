import { describe, expect, it } from "vitest";
import { keyedList } from "./list-keys";

/**
 * The plan lists these keys serve are model-authored and de-duplicated NOWHERE
 * on the way in, so "unique even when the values repeat" is the property under
 * test — not an incidental nicety.
 */
describe("keyedList", () => {
  it("keeps every row, in order", () => {
    const rows = ["a", "b", "c"];
    expect(keyedList(rows, (r) => r).map((k) => k.item)).toEqual(rows);
  });

  it("emits unique keys for duplicate values", () => {
    const keys = keyedList(["a", "a", "a", "b"], (r) => r).map((k) => k.key);
    expect(keys).toHaveLength(4);
    expect(new Set(keys).size).toBe(4);
  });

  it("keys the first occurrence by value, not by position", () => {
    const first = keyedList(["x", "dup", "dup"], (r) => r);
    const shifted = keyedList(["y", "dup", "dup"], (r) => r);
    // "dup"'s first-occurrence key is identical in both lists even though a
    // different value sits ahead of it — an index-only key would not be.
    expect(first[1].key).toBe(shifted[1].key);
    expect(first[1].key).not.toBe(first[2].key);
  });

  it("cannot collide a repeat with a value that spells the repeat's key", () => {
    // Without escaping, the second "a" ("a#2") would collide with the literal
    // value "a#2" keyed on its first occurrence.
    const keys = keyedList(["a", "a", "a#2"], (r) => r).map((k) => k.key);
    expect(new Set(keys).size).toBe(3);
  });

  it("stays unique when the identity is empty for several rows", () => {
    // The plans route admits a row with an empty sku (name-only), so the
    // identity we derive can legitimately be "" more than once.
    const rows = [
      { sku: "", name: "" },
      { sku: "", name: "" },
    ];
    const keys = keyedList(rows, (r) => r.sku || r.name).map((k) => k.key);
    expect(new Set(keys).size).toBe(2);
  });

  it("derives the key from the identity function, not the item", () => {
    const rows = [
      { sku: "BW-1", units: 10 },
      { sku: "BW-1", units: 40 },
    ];
    const keys = keyedList(rows, (r) => r.sku).map((k) => k.key);
    expect(keys[0]).toContain("BW-1");
    expect(new Set(keys).size).toBe(2);
  });

  it("returns an empty list unchanged", () => {
    expect(keyedList([], (r: string) => r)).toEqual([]);
  });
});
