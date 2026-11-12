import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cloneValue } from "../clone-value";

// The local deep clone runs only when there is no global structuredClone
// (Hermes). Each case runs in both modes against the same expectations;
// clone-value-differential.test.ts compares the two modes with each other.
const modes = [
  ["without a global structuredClone", false],
  ["with the global structuredClone", true],
] as const;

describe.each(modes)("cloneValue %s", (_name, withGlobal) => {
  let saved: PropertyDescriptor | undefined;

  beforeEach(() => {
    saved = Object.getOwnPropertyDescriptor(globalThis, "structuredClone");
    if (!withGlobal) {
      delete (globalThis as { structuredClone?: unknown }).structuredClone;
    }
  });

  afterEach(() => {
    if (saved) Object.defineProperty(globalThis, "structuredClone", saved);
  });

  it("runs in the mode it says", () => {
    expect(typeof globalThis.structuredClone).toBe(
      withGlobal ? "function" : "undefined",
    );
  });

  it("keeps undefined, null and primitives", () => {
    expect(cloneValue(undefined)).toBeUndefined();
    expect(cloneValue(null)).toBeNull();
    expect(cloneValue("s")).toBe("s");
    expect(cloneValue(true)).toBe(true);
    expect(cloneValue(Number.NaN)).toBeNaN();
    expect(cloneValue(Number.POSITIVE_INFINITY)).toBe(Infinity);
    expect(cloneValue(Number.NEGATIVE_INFINITY)).toBe(-Infinity);
    expect(Object.is(cloneValue(-0), -0)).toBe(true);
    expect(cloneValue(BigInt(42))).toBe(BigInt(42));
  });

  it("deep-copies plain objects and arrays", () => {
    const value = { a: [1, { b: 2 }], c: { d: undefined, e: null } };
    const copy = cloneValue(value);
    expect(copy).toEqual(value);
    expect(copy).not.toBe(value);
    expect(copy.a).not.toBe(value.a);
    expect(copy.a[1]).not.toBe(value.a[1]);
    expect(copy.c).not.toBe(value.c);
    expect("d" in copy.c).toBe(true);
    // A sparse array keeps its length and its hole.
    // eslint-disable-next-line no-sparse-arrays
    const sparse = cloneValue([1, , 3]);
    expect(sparse).toHaveLength(3);
    expect(1 in sparse).toBe(false);
  });

  it("drops the prototype of a class instance, like structuredClone", () => {
    class Point {
      constructor(
        public x: number,
        public y: number,
      ) {}
    }
    const copy = cloneValue(new Point(1, 2));
    expect(Object.getPrototypeOf(copy)).toBe(Object.prototype);
    expect(copy).toEqual({ x: 1, y: 2 });
  });

  it("copies Date, Map, Set, RegExp and boxed primitives", () => {
    const date = new Date(1234);
    const key = { k: 1 };
    const map = new Map<unknown, unknown>([[key, { v: 1 }]]);
    const set = new Set([{ s: 1 }]);
    const regexp = /a+b/gi;
    const copy = cloneValue({ date, map, set, regexp, boxed: Object("x") });
    expect(copy.date).toBeInstanceOf(Date);
    expect(copy.date).not.toBe(date);
    expect(copy.date.getTime()).toBe(1234);
    expect(copy.map).toBeInstanceOf(Map);
    expect(copy.map).not.toBe(map);
    const [[copiedKey, copiedValue]] = [...copy.map];
    expect(copiedKey).toEqual(key);
    expect(copiedKey).not.toBe(key);
    expect(copiedValue).toEqual({ v: 1 });
    expect(copy.set).toBeInstanceOf(Set);
    expect([...copy.set][0]).toEqual({ s: 1 });
    expect([...copy.set][0]).not.toBe([...set][0]);
    expect(copy.regexp).toBeInstanceOf(RegExp);
    expect(copy.regexp).not.toBe(regexp);
    expect(copy.regexp.source).toBe("a+b");
    expect(copy.regexp.flags).toBe("gi");
    expect(copy.boxed).toBeInstanceOf(String);
    expect(String(copy.boxed)).toBe("x");
  });

  it("copies typed arrays and their buffer", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const copy = cloneValue(bytes);
    expect(copy).toBeInstanceOf(Uint8Array);
    expect(copy.buffer).not.toBe(bytes.buffer);
    expect([...copy]).toEqual([1, 2, 3]);
  });

  it("copies an Error with its name and message", () => {
    const copy = cloneValue(new TypeError("bad"));
    expect(copy).toBeInstanceOf(TypeError);
    expect(copy.name).toBe("TypeError");
    expect(copy.message).toBe("bad");
  });

  it("keeps cycles and shared references", () => {
    type Node = { name: string; self?: Node; peer?: object; list?: object[] };
    const shared = { s: 1 };
    const value: Node = { name: "n", peer: shared, list: [shared] };
    value.self = value;
    const copy = cloneValue(value);
    expect(copy).not.toBe(value);
    expect(copy.self).toBe(copy);
    expect(copy.peer).not.toBe(shared);
    expect(copy.list![0]).toBe(copy.peer);
    const map = new Map<string, unknown>();
    map.set("me", map);
    const mapCopy = cloneValue(map);
    expect(mapCopy.get("me")).toBe(mapCopy);
  });

  it("throws a DataCloneError for functions, symbols, WeakMap and Promise", () => {
    for (const value of [
      () => 1,
      { nested: { fn: () => 1 } },
      Symbol("s"),
      [Symbol("s")],
      new WeakMap(),
      Promise.resolve(),
    ]) {
      expect(() => cloneValue(value)).toThrow(
        expect.objectContaining({ name: "DataCloneError" }),
      );
    }
  });
});

describe("cloneValue exports", () => {
  it("is the same function on the package root and the generative UI entry", async () => {
    const root = await import("../../index");
    const entry = await import("../index");
    expect(root.cloneValue).toBe(cloneValue);
    expect(entry.cloneValue).toBe(cloneValue);
  });
});

/**
 * Spies on the first brand checks that a non-array object reaches. Each
 * one that fails throws and catches an exception, slow on Hermes.
 */
function spyOnBrandChecks() {
  return [
    vi.spyOn(Date.prototype, "getTime"),
    vi.spyOn(Map.prototype, "has"),
    vi.spyOn(Set.prototype, "has"),
  ];
}
const calls = (spies: { mock: { calls: unknown[] } }[]) =>
  spies.reduce((sum, spy) => sum + spy.mock.calls.length, 0);

describe("cloneValue without a global structuredClone, on plain data", () => {
  let saved: PropertyDescriptor | undefined;

  beforeEach(() => {
    saved = Object.getOwnPropertyDescriptor(globalThis, "structuredClone");
    delete (globalThis as { structuredClone?: unknown }).structuredClone;
  });

  afterEach(() => {
    if (saved) Object.defineProperty(globalThis, "structuredClone", saved);
    vi.restoreAllMocks();
  });

  it("runs no brand check, so throws no exception, for plain objects and arrays", () => {
    // A streamed surface: a few hundred nested plain objects.
    const tree = {
      components: Array.from({ length: 300 }, (_, index) => ({
        id: `c${index}`,
        props: { label: { text: `Item ${index}` }, style: { gap: index } },
        children: [{ ref: `c${index + 1}` }],
      })),
      meta: Object.assign(Object.create(null), { n: 1 }),
    };
    const spies = spyOnBrandChecks();
    const copy = cloneValue(tree);
    expect(calls(spies)).toBe(0);
    expect(copy).toEqual(tree);
    expect(copy.components[0]).not.toBe(tree.components[0]);
  });

  it("still runs the brand checks for other objects", () => {
    class Point {
      x = 1;
    }
    const spies = spyOnBrandChecks();
    expect(cloneValue({ when: new Date(5), at: new Point() })).toEqual({
      when: new Date(5),
      at: { x: 1 },
    });
    expect(calls(spies)).toBeGreaterThan(0);
  });

  it("does not take the fast path for arguments, Errors or boxed values", () => {
    const args = (function () {
      // eslint-disable-next-line prefer-rest-params
      return arguments;
    })();
    expect(() => cloneValue(args)).toThrow(
      expect.objectContaining({ name: "DataCloneError" }),
    );
    const error = Object.setPrototypeOf(new Error("x"), Object.prototype);
    expect(cloneValue(error)).toBeInstanceOf(Error);
    const boxed = Object.setPrototypeOf(new Number(3), null);
    expect(Number.prototype.valueOf.call(cloneValue(boxed))).toBe(3);
    const view = Object.setPrototypeOf(new Uint8Array([1]), Object.prototype);
    expect(cloneValue(view)).toBeInstanceOf(Uint8Array);
  });
});
