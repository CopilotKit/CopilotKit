import { describe, expect, it } from "vitest";
import {
  ComponentModel,
  DataModel,
  SurfaceComponentsModel,
  SurfaceModel,
} from "../surface-model";

// The expected values here are what A2UI web_core 0.15 does, which the
// surface model replaced: each case was run against web_core's DataModel.

/** Subscribes to `paths` and records each notification as [path, value]. */
function record(model: DataModel, paths: string[]) {
  const calls: Array<[string, unknown]> = [];
  const subscriptions = paths.map((path) =>
    model.subscribe(path, (value) => calls.push([path, value])),
  );
  return { calls, subscriptions };
}

describe("DataModel paths", () => {
  it("reads and writes JSON Pointers, with ~1 and ~0 escapes", () => {
    const model = new DataModel({});
    model.set("/a~1b/c~0d", 1);
    expect(model.get("/")).toEqual({ "a/b": { "c~d": 1 } });
    expect(model.get("/a~1b/c~0d")).toBe(1);
  });

  it("ignores empty segments", () => {
    const model = new DataModel({});
    model.set("//a//b/", 1);
    expect(model.get("/a/b")).toBe(1);
    expect(model.get("")).toEqual({ a: { b: 1 } });
  });

  it("makes an array for an index segment and an object otherwise", () => {
    const model = new DataModel({});
    model.set("/a/0/b", 1);
    model.set("/x/y", 2);
    model.set("/n/3", "d");
    expect(model.get("/")).toEqual({
      a: [{ b: 1 }],
      x: { y: 2 },
      n: [undefined, undefined, undefined, "d"],
    });
  });

  it("replaces a null container on the way", () => {
    const model = new DataModel({ a: null });
    model.set("/a/0", 1);
    expect(model.get("/")).toEqual({ a: [1] });
  });

  it("does not take an inherited key for stored data", () => {
    const model = new DataModel({});
    expect(model.get("/toString")).toBeUndefined();
    model.set("/toString/x", 1);
    expect(model.get("/")).toEqual({ toString: { x: 1 } });
  });

  it("removes the key for null and undefined, and keeps array slots", () => {
    const model = new DataModel({ a: 1, b: [1, 2, 3], c: 3 });
    model.set("/a", null);
    model.set("/c", undefined);
    model.set("/b/1", null);
    model.set("/b/9", null);
    const data = model.get("/") as { b: unknown[] };
    expect(data).toEqual({ b: [1, undefined, 3] });
    expect("a" in data).toBe(false);
    expect(data.b).toHaveLength(3);
  });

  it("resets the root to {} for null", () => {
    const model = new DataModel({ a: 1 });
    model.set("/", null);
    expect(model.get("/")).toEqual({});
    model.set("", { b: 1 });
    expect(model.get("/")).toEqual({ b: 1 });
  });

  it("returns undefined for paths that are not there", () => {
    const model = new DataModel({ a: [1], s: "str" });
    expect(model.get("/a/1")).toBeUndefined();
    expect(model.get("/a/-1")).toBeUndefined();
    expect(model.get("/a/01")).toBeUndefined();
    expect(model.get("/s/length")).toBeUndefined();
    expect(model.get("/missing/deep")).toBeUndefined();
  });

  it("returns and stores values by reference", () => {
    const initial = { a: { b: 1 } };
    const model = new DataModel(initial);
    expect(model.get("/")).toBe(initial);
    expect(model.get("/a")).toBe(initial.a);
    const value = { z: 1 };
    model.set("/v", value);
    expect(model.get("/v")).toBe(value);
  });

  it("makes a container for a null or missing root", () => {
    const model = new DataModel(null);
    expect(model.get("/")).toBeNull();
    model.set("/a", 1);
    expect(model.get("/")).toEqual({ a: 1 });
    expect(new DataModel().get("/")).toEqual({});
  });

  it.each([
    [
      "through a primitive",
      { a: 1 },
      "/a/b",
      "Cannot set path '/a/b': segment 'a' is a primitive value.",
    ],
    [
      "through a primitive root",
      5,
      "/a",
      "Cannot set path '/a': the data model root is a primitive value.",
    ],
    [
      "a non-index segment on an array",
      { a: [] },
      "/a/x",
      "Cannot use non-numeric segment 'x' on an array in path '/a/x'.",
    ],
    [
      "an index above 10000",
      {},
      "/a/10001",
      "Cannot set path '/a/10001': array index '10001' exceeds maximum supported index (10000).",
    ],
    [
      "a forbidden segment",
      {},
      "/__proto__/x",
      "Forbidden path segment '__proto__' in path '/__proto__/x'.",
    ],
  ])("rejects a write %s", (_name, initial, path, message) => {
    const model = new DataModel(initial);
    expect(() => model.set(path, 1)).toThrow(message);
  });

  it("rejects forbidden segments on read and subscribe", () => {
    const model = new DataModel({});
    expect(() => model.get("/constructor")).toThrow(
      "Forbidden path segment 'constructor' in path '/constructor'.",
    );
    expect(() => model.subscribe("/prototype", () => {})).toThrow(
      "Forbidden path segment 'prototype'",
    );
  });

  it("does not throw when removing a missing key below a primitive", () => {
    const model = new DataModel({ a: 1, list: [] });
    expect(() => model.set("/a/b", null)).not.toThrow();
    expect(() => model.set("/list/x", undefined)).not.toThrow();
    expect(model.get("/")).toEqual({ a: 1, list: [] });
  });
});

describe("DataModel subscriptions", () => {
  it("notifies the written path, the paths above it and the paths below it", () => {
    const model = new DataModel({ a: { b: { c: 1 } } });
    const { calls } = record(model, [
      "/",
      "/a",
      "/a/b",
      "/a/b/c",
      "/a/x",
      "/ab",
    ]);
    model.set("/a/b", { c: 2 });
    expect(calls).toEqual([
      ["/a/b/c", 2],
      ["/", { a: { b: { c: 2 } } }],
      ["/a", { b: { c: 2 } }],
      ["/a/b", { c: 2 }],
    ]);
  });

  it("orders the paths in reverse of update order, and each path's subscribers oldest first", () => {
    const model = new DataModel({ a: { b: { c: 1, d: 2 } } });
    const order: string[] = [];
    const subscribers: Array<[string, string]> = [
      ["s1", "/a"],
      ["s2", "/a/b/d"],
      ["s3", "/a"],
      ["s4", "/a/b/c"],
      ["s5", "/"],
      ["s6", "/a/b"],
      ["s7", "/a"],
    ];
    for (const [name, path] of subscribers) {
      model.subscribe(path, () => order.push(name));
    }
    model.set("/a/b", { c: 3, d: 4 });
    expect(order).toEqual(["s4", "s2", "s5", "s1", "s3", "s7", "s6"]);
  });

  it("does not notify a path whose primitive value stayed the same", () => {
    const model = new DataModel({ a: 1, o: { b: 1 } });
    const { calls } = record(model, ["/", "/a", "/o/b", "/o/q"]);
    model.set("/a", 1);
    model.set("/o", { b: 1 });
    // The root holds an object, so it always counts as changed.
    expect(calls.map(([path]) => path)).toEqual(["/", "/"]);
  });

  it("notifies NaN again, as a changed value", () => {
    const model = new DataModel({ a: Number.NaN });
    const { calls } = record(model, ["/a"]);
    model.set("/a", Number.NaN);
    expect(calls).toHaveLength(1);
  });

  it("passes a shallow copy of an object or an array", () => {
    const initial = { a: { b: 1 }, list: [1] };
    const model = new DataModel(initial);
    let object: unknown;
    let list: unknown;
    model.subscribe("/a", (value) => (object = value));
    model.subscribe("/list", (value) => (list = value));
    model.set("/a/b", 2);
    model.set("/list/1", 2);
    expect(object).toEqual({ b: 2 });
    expect(object).not.toBe(model.get("/a"));
    expect(list).toEqual([1, 2]);
    expect(list).not.toBe(model.get("/list"));
  });

  it("does not notify for the removal of a missing key", () => {
    const model = new DataModel({ a: 1 });
    const { calls } = record(model, ["/", "/b"]);
    model.set("/b", undefined);
    model.set("/b", null);
    expect(calls).toEqual([]);
  });

  it("notifies an array slot that a removal cleared, once", () => {
    const model = new DataModel({ a: [1, 2] });
    const { calls } = record(model, ["/a/1"]);
    model.set("/a/1", undefined);
    model.set("/a/1", undefined);
    expect(calls).toEqual([["/a/1", undefined]]);
  });

  it("notifies every changed path on a root write", () => {
    const model = new DataModel({ a: 1 });
    const { calls } = record(model, ["/", "/a", "/b"]);
    model.set("/", { a: 1, b: 2 });
    expect(calls).toEqual([
      ["/b", 2],
      ["/", { a: 1, b: 2 }],
    ]);
  });

  it("normalizes the subscribed path", () => {
    const model = new DataModel({});
    const { calls } = record(model, ["/a/"]);
    model.set("//a//b", 1);
    expect(calls).toEqual([["/a/", { b: 1 }]]);
  });

  it("does not call the subscriber with the current value", () => {
    const model = new DataModel({ a: 1 });
    const { calls } = record(model, ["/a"]);
    expect(calls).toEqual([]);
  });

  it("stops after unsubscribe, also when unsubscribed by an earlier subscriber", () => {
    const model = new DataModel({});
    const calls: string[] = [];
    const first = model.subscribe("/a", () => {
      calls.push("first");
      second.unsubscribe();
    });
    const second = model.subscribe("/a", () => calls.push("second"));
    model.set("/a", 1);
    first.unsubscribe();
    model.set("/a", 2);
    expect(calls).toEqual(["first"]);
  });

  it("runs the writes of a subscriber after the current round", () => {
    const model = new DataModel({});
    const calls: string[] = [];
    model.subscribe("/x", (value) => {
      calls.push(`x${value}`);
      if (value === 1) {
        model.set("/y", 1);
        model.set("/y", 2);
        model.set("/x", 2);
      }
    });
    model.subscribe("/y", (value) => calls.push(`y${value}`));
    model.subscribe("/x", (value) => calls.push(`x'${value}`));
    model.set("/x", 1);
    // x' was still queued from the first write, so it runs once, with 2.
    expect(calls).toEqual(["x1", "x'2", "x2", "y2"]);
  });

  it("runs every subscriber when one throws, then throws its error", () => {
    const model = new DataModel({});
    const calls: unknown[] = [];
    model.subscribe("/a", () => {
      throw new Error("boom");
    });
    model.subscribe("/a", (value) => calls.push(value));
    expect(() => model.set("/a", 1)).toThrow("boom");
    expect(calls).toEqual([1]);
    expect(model.get("/a")).toBe(1);
  });

  it("stops a subscriber that keeps writing its own path", () => {
    const model = new DataModel({ n: 0 });
    model.subscribe("/n", (value) => model.set("/n", (value as number) + 1));
    expect(() => model.set("/n", 1)).toThrow("Cycle detected");
  });

  it("ends every subscription on dispose and keeps the data", () => {
    const model = new DataModel({});
    const { calls } = record(model, ["/a", "/"]);
    model.dispose();
    model.set("/a", 1);
    expect(calls).toEqual([]);
    expect(model.get("/a")).toBe(1);
    const { calls: later } = record(model, ["/a"]);
    model.set("/a", 2);
    expect(later).toEqual([["/a", 2]]);
  });
});

describe("SurfaceComponentsModel", () => {
  it("adds, gets and removes components, in the order they were added", () => {
    const components = new SurfaceComponentsModel();
    const root = new ComponentModel("root", "Column", { children: ["a"] });
    const a = new ComponentModel("a", "Text", { text: "hi" });
    components.addComponent(root);
    components.addComponent(a);
    expect(components.get("root")).toBe(root);
    expect([...components.entries].map(([id]) => id)).toEqual(["root", "a"]);
    components.removeComponent("root");
    components.removeComponent("missing");
    components.addComponent(root);
    expect([...components.entries].map(([id]) => id)).toEqual(["a", "root"]);
    expect(components.get("missing")).toBeUndefined();
  });

  it("rejects a second component with the same id", () => {
    const components = new SurfaceComponentsModel();
    components.addComponent(new ComponentModel("a", "Text", {}));
    expect(() =>
      components.addComponent(new ComponentModel("a", "Box", {})),
    ).toThrow("Component with id 'a' already exists.");
  });

  it("keeps the id, the type and the replaceable properties of a component", () => {
    const component = new ComponentModel("a", "Text", { text: "hi" });
    expect(component).toMatchObject({ id: "a", type: "Text" });
    component.properties = { text: "bye" };
    expect(component.properties).toEqual({ text: "bye" });
  });
});

describe("SurfaceModel", () => {
  it("starts with an empty data model and no components", () => {
    const surface = new SurfaceModel("s1");
    expect(surface.id).toBe("s1");
    expect(surface.dataModel.get("/")).toEqual({});
    expect([...surface.componentsModel.entries]).toEqual([]);
  });

  it("drops its components and data subscriptions on dispose", () => {
    const surface = new SurfaceModel("s1");
    surface.componentsModel.addComponent(new ComponentModel("root", "Box", {}));
    const { calls } = record(surface.dataModel, ["/a"]);
    surface.dispose();
    surface.dataModel.set("/a", 1);
    expect(calls).toEqual([]);
    expect(surface.componentsModel.get("root")).toBeUndefined();
  });
});
