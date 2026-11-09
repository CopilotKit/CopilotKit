import { describe, expect, it, vi } from "vitest";
import { DataModel } from "@a2ui/web_core/state";
import type {
  A2UIOperation,
  GenerativeUISurfaceContent,
} from "@copilotkit/shared";
import { createGenerativeUI } from "@copilotkit/shared/generative-ui";
import { GenerativeUISurfaceManager, surfaceKey } from "../surface-manager";
import { installHermesGlobals } from "./hermes-globals";

// A user value goes into the data model and, through describeSurfaces, into
// the JSON request of the next run. The contract, the same as before the
// React Native work: the data model keeps a copy made with structuredClone
// semantics, so a cleared number input (NaN) or a date picker (Date) keeps
// working. The agent is told what JSON.stringify makes of it (NaN becomes
// null, a Date its ISO string, a Map {}). A value JSON refuses (a bigint, a
// cycle) is kept but left out of the description, with a console.warn, so
// building the request never throws. Only a value structuredClone refuses
// (a function, a symbol, a WeakMap...) throws, and then nothing is written.
// All of it holds with and without the Hermes globals.

const Noop = () => null;
const ui = createGenerativeUI({
  id: "app",
  components: {
    Column: { component: Noop, slots: { children: "multiple" } },
  },
});
const create: A2UIOperation = {
  version: "1.0",
  createSurface: { surfaceId: "s1", catalogId: "app" },
};
const data = (path: string, value: unknown): A2UIOperation => ({
  version: "1.0",
  updateDataModel: { surfaceId: "s1", path, value },
});
const ops = [create, data("/form", { email: "agent@x.io" })];
const content = (operations: A2UIOperation[]): GenerativeUISurfaceContent => ({
  surfaceId: "s1",
  target: "chat",
  catalogId: "app",
  operations,
  status: "streaming",
  rejected: [],
});
const key = surfaceKey("t1", "s1");
// Node's structuredClone, the reference: the Hermes mode removes the global.
const nativeClone = globalThis.structuredClone;

class Point {
  x = 1;
  get double() {
    return this.x * 2;
  }
}
const cyclic = () => {
  const value: Record<string, unknown> = { n: 1 };
  value.self = value;
  return value;
};

/** Values that structuredClone refuses. Each one throws; nothing is written. */
const UNCLONEABLE: Record<string, () => unknown> = {
  function: () => ({ run: () => 1 }),
  symbol: () => Symbol("s"),
  "function in an array": () => [() => 1],
  WeakMap: () => ({ w: new WeakMap() }),
  Promise: () => Promise.resolve(1),
};

/**
 * Values that are stored as structuredClone stores them, and that reach the
 * agent as JSON.stringify writes them.
 */
const STORED: Record<string, () => unknown> = {
  NaN: () => Number.NaN,
  "NaN in an object": () => ({ amount: Number.NaN }),
  Infinity: () => ({ n: Number.POSITIVE_INFINITY }),
  "-0": () => -0,
  Date: () => new Date(86_400_000),
  "Date in an object": () => ({ due: new Date(0) }),
  Map: () => new Map([["a", 1]]),
  Set: () => ({ tags: new Set(["x"]) }),
  RegExp: () => /a/g,
  Error: () => new Error("x"),
  "typed array": () => new Uint8Array([1, 2]),
  "boxed string": () => new String("x"),
  "class instance": () => new Point(),
  "an undefined member": () => ({ a: undefined, b: 1 }),
  // eslint-disable-next-line no-sparse-arrays
  "undefined in an array and a hole": () => [undefined, , 3],
  "a shared reference": () => {
    const shared = { n: 1 };
    return { a: shared, b: shared };
  },
};

/** Values JSON refuses. Stored, but left out of the description. */
const NOT_DESCRIBED: Record<string, () => unknown> = {
  bigint: () => BigInt(1),
  "nested bigint": () => ({ n: [BigInt(1)] }),
  "boxed bigint": () => Object(BigInt(1)),
  cycle: cyclic,
};

/** JSON data, with the value the data model and the agent get. */
const ACCEPTED: Record<string, [() => unknown, unknown]> = {
  string: [() => "Ada", "Ada"],
  number: [() => 3.5, 3.5],
  boolean: [() => false, false],
  "plain object": [() => ({ a: [1, { b: "x" }], c: null }), null],
  "null prototype": [
    () => Object.assign(Object.create(null), { a: 1 }),
    { a: 1 },
  ],
  "own __proto__ key stays an own key": [
    () => JSON.parse('{"__proto__":{"p":1}}'),
    JSON.parse('{"__proto__":{"p":1}}'),
  ],
};

function describedValue(manager: GenerativeUISurfaceManager, path: string) {
  return manager.describeSurfaces("t1").s1!.dataModel?.[path];
}

/**
 * The description agrees with the data model: it is JSON, and writing each
 * described value back at its path, the way an agent updateDataModel would,
 * leaves the data model as it is.
 */
function expectAgreement(manager: GenerativeUISurfaceManager) {
  const described = manager.describeSurfaces("t1");
  expect(JSON.parse(JSON.stringify(described))).toEqual(described);
  const surface = manager.getSurface("t1", "s1")!;
  const live = surface.model.dataModel.get("/");
  const replay = new DataModel(JSON.parse(JSON.stringify(live ?? {})));
  for (const [path, value] of Object.entries(described.s1?.dataModel ?? {})) {
    replay.set(path, JSON.parse(JSON.stringify(value)));
  }
  expect(replay.get("/")).toEqual(live);
}

const modes = [
  ["with Node globals", false],
  ["with Hermes globals", true],
] as const;

describe.each(modes)("user values %s", (_name, hermes) => {
  const run = (test: () => void) => () => {
    const restore = hermes ? installHermesGlobals() : undefined;
    try {
      test();
    } finally {
      restore?.();
    }
  };

  it.each(Object.keys(UNCLONEABLE))(
    "refuses %s with a DataCloneError and writes nothing",
    (name) =>
      run(() => {
        const manager = new GenerativeUISurfaceManager(ui);
        manager.ingest("t1", "default", content(ops));
        let thrown: unknown;
        try {
          manager.setOwnedValue(key, "/form/v", UNCLONEABLE[name]!());
        } catch (error) {
          thrown = error;
        }
        expect((thrown as Error | undefined)?.name).toBe("DataCloneError");
        expect(
          manager.getSurface("t1", "s1")!.model.dataModel.get("/form"),
        ).toEqual({ email: "agent@x.io" });
        expect(manager.describeSurfaces("t1").s1!.dataModel).toBeUndefined();
        expectAgreement(manager);
      })(),
  );

  it.each(Object.keys(STORED))(
    "stores %s like structuredClone and tells the agent its JSON",
    (name) =>
      run(() => {
        const manager = new GenerativeUISurfaceManager(ui);
        manager.ingest("t1", "default", content(ops));
        const input = STORED[name]!();
        manager.setOwnedValue(key, "/form/v", input);
        const stored = manager
          .getSurface("t1", "s1")!
          .model.dataModel.get("/form/v");
        // The same value and kind as structuredClone gives (Node's, here).
        expect(stored).toStrictEqual(nativeClone(input));
        if (typeof input === "object" && input !== null) {
          expect(stored).not.toBe(input);
        } else {
          expect(Object.is(stored, input)).toBe(true);
        }
        // The agent gets what JSON.stringify makes of it, as before.
        const json = JSON.parse(JSON.stringify(input) ?? "null");
        expect(describedValue(manager, "/form/v")).toEqual(json);
        const request = JSON.stringify(manager.describeSurfaces("t1"));
        expect(JSON.parse(request).s1.dataModel["/form/v"]).toEqual(json);
        // An agent write to the parent, then a rebuild, keep the value.
        manager.ingest(
          "t1",
          "default",
          content([...ops, data("/form", { email: "b@x.io" })]),
        );
        expect(
          manager.getSurface("t1", "s1")!.model.dataModel.get("/form/v"),
        ).toStrictEqual(nativeClone(input));
        manager.ingest("t1", "default", content([create]));
        expect(
          manager.getSurface("t1", "s1")!.model.dataModel.get("/form/v"),
        ).toStrictEqual(nativeClone(input));
        expect(describedValue(manager, "/form/v")).toEqual(json);
      })(),
  );

  it.each(Object.keys(NOT_DESCRIBED))(
    "stores %s, leaves it out of the description and warns, never throwing",
    (name) =>
      run(() => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        try {
          const manager = new GenerativeUISurfaceManager(ui);
          manager.ingest("t1", "default", content(ops));
          manager.setOwnedValue(key, "/form/ok", "kept");
          expect(() =>
            manager.setOwnedValue(key, "/form/v", NOT_DESCRIBED[name]!()),
          ).not.toThrow();
          expect(
            manager.getSurface("t1", "s1")!.model.dataModel.get("/form/v"),
          ).toBeDefined();
          expect(warn).toHaveBeenCalledTimes(1);
          expect(String(warn.mock.calls[0]![0])).toContain('"/form/v"');
          // Building the request does not throw, and the other user values
          // still reach the agent.
          let request = "";
          expect(() => {
            request = JSON.stringify(manager.describeSurfaces("t1"));
          }).not.toThrow();
          expect(JSON.parse(request).s1.dataModel).toEqual({
            "/form/ok": "kept",
          });
          // Describing again does not warn again.
          manager.describeSurfaces("t1");
          expect(warn).toHaveBeenCalledTimes(1);
          // A JSON value written over it is described again.
          manager.setOwnedValue(key, "/form/v", 2);
          expect(describedValue(manager, "/form/v")).toBe(2);
        } finally {
          warn.mockRestore();
        }
      })(),
  );

  it.each(Object.keys(ACCEPTED))("accepts %s, as JSON", (name) =>
    run(() => {
      const [make, expected] = ACCEPTED[name]!;
      const manager = new GenerativeUISurfaceManager(ui);
      manager.ingest("t1", "default", content(ops));
      const input = make();
      manager.setOwnedValue(key, "/form/v", input);
      const want =
        expected === null ? JSON.parse(JSON.stringify(input)) : expected;
      const stored = manager
        .getSurface("t1", "s1")!
        .model.dataModel.get("/form/v");
      expect(stored).toEqual(want);
      expect(Object.is(stored, -0)).toBe(false);
      expect(describedValue(manager, "/form/v")).toEqual(want);
      expectAgreement(manager);
      // An agent write to the parent, then a rebuild, keep both in step.
      manager.ingest(
        "t1",
        "default",
        content([...ops, data("/form", { email: "b@x.io" })]),
      );
      expectAgreement(manager);
      manager.ingest("t1", "default", content([create]));
      expectAgreement(manager);
    })(),
  );

  it.each([
    ["null", null],
    ["undefined", undefined],
  ])("a user %s removes the key and tells the agent null", (_label, value) =>
    run(() => {
      const manager = new GenerativeUISurfaceManager(ui);
      manager.ingest("t1", "default", content(ops));
      manager.setOwnedValue(key, "/form/email", value);
      const surface = manager.getSurface("t1", "s1")!;
      expect(surface.model.dataModel.get("/form")).toEqual({});
      // null is how the protocol says "removed"; the path stays the user's,
      // so the agent sees it listed and knows its writes there are ignored.
      expect(manager.describeSurfaces("t1").s1!.dataModel).toEqual({
        "/form/email": null,
      });
      expectAgreement(manager);
      // An agent write to the parent and a rebuild keep the user's delete.
      manager.ingest(
        "t1",
        "default",
        content([...ops, data("/form", { email: "again@x.io", n: 1 })]),
      );
      expect(surface.model.dataModel.get("/form")).toEqual({ n: 1 });
      expectAgreement(manager);
      manager.ingest("t1", "default", content(ops));
      expect(
        manager.getSurface("t1", "s1")!.model.dataModel.get("/form"),
      ).toEqual({});
      expectAgreement(manager);
      // Agent writes to the other paths still land.
      manager.ingest(
        "t1",
        "default",
        content([...ops, data("/form/other", 2)]),
      );
      expect(
        manager.getSurface("t1", "s1")!.model.dataModel.get("/form"),
      ).toEqual({ other: 2 });
    })(),
  );

  it(
    "keeps owned values unaliased after a merge, a rebuild and debugSurfaces",
    run(() => {
      const manager = new GenerativeUISurfaceManager(ui);
      manager.ingest("t1", "default", content(ops));
      manager.setOwnedValue(key, "/form/name", { first: "Ada" });
      // An agent write to the parent merges the owned value in (mergeOwnedValues).
      manager.ingest(
        "t1",
        "default",
        content([...ops, data("/form", { email: "b@x.io" })]),
      );
      const merged = manager
        .getSurface("t1", "s1")!
        .model.dataModel.get("/form/name") as { first: string };
      merged.first = "MUTATED after merge";
      expect(describedValue(manager, "/form/name")).toEqual({ first: "Ada" });
      // A rebuild writes the owned values back (restoreOwnedValues).
      manager.ingest("t1", "default", content([create]));
      const restored = manager
        .getSurface("t1", "s1")!
        .model.dataModel.get("/form/name") as { first: string };
      expect(restored).toEqual({ first: "Ada" });
      restored.first = "MUTATED after rebuild";
      expect(describedValue(manager, "/form/name")).toEqual({ first: "Ada" });
      // The inspector gets copies too.
      const [debug] = manager.debugSurfaces();
      (debug!.userValues["/form/name"] as { first: string }).first =
        "MUTATED in the inspector";
      expect(describedValue(manager, "/form/name")).toEqual({ first: "Ada" });
      (
        debug!.dataModel as { form: { name: { first: string } } }
      ).form.name.first = "MUTATED in the inspector's data model";
      expect(
        manager.getSurface("t1", "s1")!.model.dataModel.get("/form/name"),
      ).toEqual({ first: "MUTATED after rebuild" });
    }),
  );

  it(
    "refuses before any linked surface is written",
    run(() => {
      const manager = new GenerativeUISurfaceManager(ui);
      const other = (id: string): GenerativeUISurfaceContent => ({
        ...content([]),
        surfaceId: id,
        operations: [
          {
            version: "1.0",
            createSurface: { surfaceId: id, catalogId: "app" },
          },
        ],
      });
      manager.ingest("t1", "default", other("a"));
      manager.ingest("t1", "default", other("b"));
      manager.linkSurfaces("t1", ["a", "b"]);
      expect(() =>
        manager.setOwnedValue(surfaceKey("t1", "a"), "/v", {
          ok: 1,
          bad: () => 1,
        }),
      ).toThrow();
      for (const id of ["a", "b"]) {
        expect(manager.getSurface("t1", id)!.model.dataModel.get("/v")).toBe(
          undefined,
        );
      }
    }),
  );

  it(
    "gives each linked surface its own copy, apart from the owned value",
    run(() => {
      const manager = new GenerativeUISurfaceManager(ui);
      const other = (id: string): GenerativeUISurfaceContent => ({
        ...content([]),
        surfaceId: id,
        operations: [
          {
            version: "1.0",
            createSurface: { surfaceId: id, catalogId: "app" },
          },
        ],
      });
      for (const id of ["a", "b", "c"])
        manager.ingest("t1", "default", other(id));
      manager.linkSurfaces("t1", ["a", "b", "c"]);
      const input = { list: [{ n: 1 }], when: new Date(0) };
      manager.setOwnedValue(surfaceKey("t1", "a"), "/v", input);
      const values = ["a", "b", "c"].map(
        (id) =>
          manager.getSurface("t1", id)!.model.dataModel.get("/v") as {
            list: { n: number }[];
            when: Date;
          },
      );
      for (const value of values) {
        expect(value).toStrictEqual(nativeClone(input));
        expect(value).not.toBe(input);
        expect(value.list).not.toBe(input.list);
      }
      expect(new Set(values).size).toBe(3);
      expect(new Set(values.map((value) => value.list[0])).size).toBe(3);
      // Mutating one surface's data model, or the input, changes no other
      // surface and no owned value.
      values[0]!.list[0]!.n = 99;
      input.list[0]!.n = 42;
      expect(values[1]!.list[0]!.n).toBe(1);
      expect(values[2]!.list[0]!.n).toBe(1);
      for (const id of ["a", "b", "c"]) {
        expect(manager.describeSurfaces("t1")[id]!.dataModel!["/v"]).toEqual({
          list: [{ n: 1 }],
          when: new Date(0).toISOString(),
        });
      }
    }),
  );
});

describe("user value copies", () => {
  it("makes one owned copy and one per linked data model", () => {
    const manager = new GenerativeUISurfaceManager(ui);
    for (const id of ["a", "b", "c"]) {
      manager.ingest("t1", "default", {
        ...content([]),
        surfaceId: id,
        operations: [
          {
            version: "1.0",
            createSurface: { surfaceId: id, catalogId: "app" },
          },
        ],
      });
    }
    manager.linkSurfaces("t1", ["a", "b", "c"]);
    const clone = vi.spyOn(globalThis, "structuredClone");
    try {
      manager.setOwnedValue(surfaceKey("t1", "a"), "/v", { list: [1] });
      // 1 + N for N = 3 linked surfaces.
      expect(clone).toHaveBeenCalledTimes(4);
    } finally {
      clone.mockRestore();
    }
  });
});

describe("debugSurfaces", () => {
  it("copies a data model or the user values only when they are read", () => {
    const manager = new GenerativeUISurfaceManager(ui);
    manager.ingest("t1", "default", content(ops));
    manager.setOwnedValue(key, "/form/name", { first: "Ada" });
    const clone = vi.spyOn(globalThis, "structuredClone");
    try {
      // The inspector asks for a snapshot on every change of the manager.
      for (let i = 0; i < 5; i += 1) manager.debugSurfaces();
      expect(clone).not.toHaveBeenCalled();
      const [debug] = manager.debugSurfaces();
      expect(debug!.dataModel).toEqual({
        form: { email: "agent@x.io", name: { first: "Ada" } },
      });
      expect(debug!.dataModel).toBe(debug!.dataModel);
      expect(clone).toHaveBeenCalledTimes(1);
      expect(debug!.userValues).toEqual({ "/form/name": { first: "Ada" } });
      expect(clone).toHaveBeenCalledTimes(2);
      // What a snapshot reads stays put, and it serializes like data.
      expect(JSON.parse(JSON.stringify(debug))).toMatchObject({
        surfaceId: "s1",
        dataModel: { form: { name: { first: "Ada" } } },
        userValues: { "/form/name": { first: "Ada" } },
      });
      expect(Object.keys(debug!)).toEqual(
        expect.arrayContaining(["dataModel", "userValues"]),
      );
    } finally {
      clone.mockRestore();
    }
  });

  it("keeps the user values of the call, even when read later", () => {
    const manager = new GenerativeUISurfaceManager(ui);
    manager.ingest("t1", "default", content(ops));
    manager.setOwnedValue(key, "/form/name", "Ada");
    const [debug] = manager.debugSurfaces();
    manager.setOwnedValue(key, "/form/name", "Grace");
    expect(debug!.userValues).toEqual({ "/form/name": "Ada" });
  });
});
