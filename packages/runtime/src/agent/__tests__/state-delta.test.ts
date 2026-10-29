/**
 * Unit tests for the STATE_DELTA normalizer's handling of
 * prototype-related JSON Pointer segments. Delta operations are generated
 * by the model (untrusted input): an operation whose path or `from`
 * references `__proto__`, `constructor`, or `prototype` must be dropped
 * entirely — neither applied to the tracked state nor forwarded in the
 * normalized delta.
 */
import { describe, expect, it } from "vitest";
import { EventType, type BaseEvent, type StateDeltaEvent } from "@ag-ui/client";

import { __internals, createStateEventNormalizer } from "../state-delta";

const { normalizeStateDelta } = __internals;

function asRecord(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

describe("state-delta prototype segment guard", () => {
  it("drops add /__proto__ without touching the tracked state's prototype", () => {
    const { delta, state } = normalizeStateDelta(
      [{ op: "add", path: "/__proto__", value: { polluted: "yes" } }],
      { user: { name: "a" } },
    );

    expect(delta).toEqual([]);
    expect(Object.getPrototypeOf(state)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(state, "__proto__")).toBe(
      false,
    );
    expect(asRecord(state).polluted).toBeUndefined();
    expect(asRecord(state)).toEqual({ user: { name: "a" } });
    expect(asRecord({}).polluted).toBeUndefined();
  });

  it("drops add with a nested __proto__ segment", () => {
    const { delta, state } = normalizeStateDelta(
      [{ op: "add", path: "/a/__proto__", value: { polluted: "yes" } }],
      { a: { x: 1 } },
    );

    expect(delta).toEqual([]);
    const a = asRecord(asRecord(state).a);
    expect(Object.getPrototypeOf(a)).toBe(Object.prototype);
    expect(a.polluted).toBeUndefined();
    expect(a).toEqual({ x: 1 });
  });

  it("drops add /__proto__/- before the array initializer can fire", () => {
    const { delta, state } = normalizeStateDelta(
      [{ op: "add", path: "/__proto__/-", value: 1 }],
      { user: { name: "a" } },
    );

    expect(delta).toEqual([]);
    expect(Object.getPrototypeOf(state)).toBe(Object.prototype);
    expect(asRecord(state)).toEqual({ user: { name: "a" } });
  });

  it("drops copy and move operations targeting __proto__", () => {
    const copied = normalizeStateDelta(
      [{ op: "copy", from: "/a", path: "/__proto__" }],
      { a: { x: 1 } },
    );
    expect(copied.delta).toEqual([]);
    expect(Object.getPrototypeOf(copied.state)).toBe(Object.prototype);
    expect(asRecord(copied.state)).toEqual({ a: { x: 1 } });

    const moved = normalizeStateDelta(
      [{ op: "move", from: "/a", path: "/__proto__" }],
      { a: { x: 1 } },
    );
    expect(moved.delta).toEqual([]);
    expect(Object.getPrototypeOf(moved.state)).toBe(Object.prototype);
    expect(asRecord(moved.state)).toEqual({ a: { x: 1 } });
  });

  it("drops copy operations sourcing from __proto__", () => {
    const { delta, state } = normalizeStateDelta(
      [{ op: "copy", from: "/__proto__", path: "/copied" }],
      { a: 1 },
    );

    expect(delta).toEqual([]);
    expect(asRecord(state)).toEqual({ a: 1 });
  });

  it("drops operations with constructor or prototype segments anywhere in the path", () => {
    const attempts: unknown[] = [
      { op: "add", path: "/constructor", value: { polluted: "yes" } },
      { op: "add", path: "/a/prototype", value: { polluted: "yes" } },
      { op: "add", path: "/config/constructor/name", value: "x" },
      { op: "replace", path: "/a/__proto__", value: { polluted: "yes" } },
      { op: "remove", path: "/__proto__" },
    ];

    for (const operation of attempts) {
      const { delta, state } = normalizeStateDelta([operation], {
        a: { x: 1 },
        config: {},
      });
      expect(delta).toEqual([]);
      expect(Object.getPrototypeOf(state)).toBe(Object.prototype);
      expect(asRecord(state).polluted).toBeUndefined();
    }
  });

  it("still forwards and applies legitimate operations alongside a dropped one", () => {
    const { delta, state } = normalizeStateDelta(
      [
        { op: "add", path: "/__proto__", value: { polluted: "yes" } },
        { op: "add", path: "/user/name", value: "b" },
      ],
      { user: { name: "a" } },
    );

    expect(delta).toEqual([{ op: "add", path: "/user/name", value: "b" }]);
    expect(Object.getPrototypeOf(state)).toBe(Object.prototype);
    expect(asRecord(asRecord(state).user).name).toBe("b");
  });

  it("excludes forbidden operations from the forwarded event delta", () => {
    const normalize = createStateEventNormalizer({ user: { name: "a" } });
    const event = {
      type: EventType.STATE_DELTA,
      delta: [
        { op: "add", path: "/__proto__", value: { polluted: "yes" } },
        { op: "add", path: "/user/name", value: "b" },
      ],
    } as unknown as BaseEvent;

    const output = normalize(event);
    const deltaEvent = output.find(
      (e): e is StateDeltaEvent => e.type === EventType.STATE_DELTA,
    );
    expect(deltaEvent?.delta).toEqual([
      { op: "add", path: "/user/name", value: "b" },
    ]);
  });
});

describe("state-delta normal operations (unchanged behavior)", () => {
  it("applies and forwards add, replace, and remove", () => {
    const { delta, state } = normalizeStateDelta(
      [
        { op: "add", path: "/user/name", value: "b" },
        { op: "replace", path: "/user/age", value: 31 },
        { op: "remove", path: "/temp" },
      ],
      { user: { name: "a", age: 30 }, temp: true },
    );

    expect(delta).toHaveLength(3);
    expect(asRecord(state)).toEqual({ user: { name: "b", age: 31 } });
  });

  it("keeps the array append initializer behavior for missing arrays", () => {
    const { delta, state } = normalizeStateDelta(
      [{ op: "add", path: "/items/-", value: "x" }],
      { user: { name: "a" } },
    );

    expect(delta).toEqual([
      { op: "add", path: "/items", value: [] },
      { op: "add", path: "/items/-", value: "x" },
    ]);
    expect(asRecord(state).items).toEqual(["x"]);
  });

  it("appends to existing arrays, and applies copy and move", () => {
    const { delta, state } = normalizeStateDelta(
      [
        { op: "add", path: "/items/-", value: 3 },
        { op: "copy", from: "/a", path: "/b" },
        { op: "move", from: "/c", path: "/d" },
      ],
      { items: [1, 2], a: { x: 1 }, c: "see" },
    );

    expect(delta).toHaveLength(3);
    expect(asRecord(state)).toEqual({
      items: [1, 2, 3],
      a: { x: 1 },
      b: { x: 1 },
      d: "see",
    });
  });

  it("still forwards non-dangerous operations that do not apply", () => {
    const { delta, state } = normalizeStateDelta(
      [{ op: "replace", path: "/missing", value: 1 }],
      { a: 1 },
    );

    expect(delta).toEqual([{ op: "replace", path: "/missing", value: 1 }]);
    expect(asRecord(state)).toEqual({ a: 1 });
  });
});
