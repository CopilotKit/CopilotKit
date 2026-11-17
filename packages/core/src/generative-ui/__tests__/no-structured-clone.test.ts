import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Message } from "@ag-ui/client";
import type {
  A2UIOperation,
  GenerativeUISurfaceContent,
} from "@copilotkit/shared";
import { createGenerativeUI } from "@copilotkit/shared/generative-ui";
import { buildMarkdownSurfaces } from "../markdown-source";
import { GenerativeUISurfaceManager, surfaceKey } from "../surface-manager";

// Hermes (React Native) has no global structuredClone. The generative UI
// code must run without one, and without asking the app to install it.

const Noop = () => null;
const ui = createGenerativeUI({
  id: "app",
  components: {
    Column: { component: Noop, slots: { children: "multiple" } },
    Text: { component: Noop, props: z.object({ text: z.string() }) },
    Button: { component: Noop, props: z.object({ label: z.string() }) },
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
const components: A2UIOperation = {
  version: "1.0",
  updateComponents: {
    surfaceId: "s1",
    components: [
      { id: "root", component: "Column", children: ["note"] },
      { id: "note", component: "Text", text: "Hello" },
    ],
  },
};
const content = (operations: A2UIOperation[]): GenerativeUISurfaceContent => ({
  surfaceId: "s1",
  target: "chat",
  catalogId: "app",
  operations,
  status: "streaming",
  rejected: [],
});

describe("generative UI without a global structuredClone", () => {
  let saved: PropertyDescriptor | undefined;

  beforeEach(() => {
    saved = Object.getOwnPropertyDescriptor(globalThis, "structuredClone");
    delete (globalThis as { structuredClone?: unknown }).structuredClone;
  });

  afterEach(() => {
    if (saved) Object.defineProperty(globalThis, "structuredClone", saved);
  });

  it("applies agent data writes and user-owned writes", () => {
    expect(typeof globalThis.structuredClone).toBe("undefined");
    const manager = new GenerativeUISurfaceManager(ui);
    const ops = [create, components, data("/form", { email: "agent@x.io" })];
    manager.ingest("t1", "default", content(ops));
    const surface = manager.getSurface("t1", "s1")!;
    expect(surface.model.dataModel.get("/form/email")).toBe("agent@x.io");

    const owned = { first: "Ada" };
    manager.setOwnedValue(surfaceKey("t1", "s1"), "/form/name", owned);
    owned.first = "changed";
    expect(surface.model.dataModel.get("/form/name")).toEqual({
      first: "Ada",
    });

    // An agent write to the parent merges the user-owned value back in.
    manager.ingest(
      "t1",
      "default",
      content([...ops, data("/form", { email: "other@x.io" })]),
    );
    expect(surface.model.dataModel.get("/form")).toEqual({
      email: "other@x.io",
      name: { first: "Ada" },
    });
  });

  it("copies the data model of a markdown surface split into sub-surfaces", () => {
    const fenceOps = [
      create,
      data("/", { plan: "team" }),
      {
        version: "1.0",
        updateComponents: {
          surfaceId: "s1",
          components: [
            {
              id: "root",
              component: "Column",
              children: ["buy", "note", "more"],
            },
            { id: "buy", component: "Button", label: "Buy" },
            { id: "note", component: "Text", text: "Or see more." },
            { id: "more", component: "Button", label: "More" },
          ],
        },
      },
    ];
    const body = fenceOps.map((op) => JSON.stringify(op)).join("\n");
    const message: Message = {
      id: "m1",
      role: "assistant",
      content: `\`\`\`a2ui\n${body}\n\`\`\`\n`,
    };
    const { surfaces } = buildMarkdownSurfaces([message], {
      ui,
      functions: {},
      running: false,
    });
    // The fence was split: one sub-surface per prose-separated part.
    expect(surfaces.length).toBeGreaterThan(1);
    const values = surfaces.flatMap((surface) =>
      surface.operations
        .map((op) => op as { updateDataModel?: { value?: unknown } })
        .filter((op) => op.updateDataModel)
        .map((op) => op.updateDataModel!.value),
    );
    expect(values.length).toBe(surfaces.length);
    for (const value of values) expect(value).toEqual({ plan: "team" });
    // Each sub-surface has its own copy, not one shared object.
    expect(new Set(values).size).toBe(values.length);
  });

  describe("agent data writes", () => {
    const key = surfaceKey("t1", "s1");

    it("deletes the key for a null updateDataModel value, not writing {}", () => {
      expect(typeof globalThis.structuredClone).toBe("undefined");
      const manager = new GenerativeUISurfaceManager(ui);
      const base = [create, components, data("/form", { a: 1, b: 2 })];
      manager.ingest("t1", "default", content(base));
      manager.ingest(
        "t1",
        "default",
        content([...base, data("/form/a", null)]),
      );
      const surface = manager.getSurface("t1", "s1")!;
      expect(surface.model.dataModel.get("/")).toEqual({ form: { b: 2 } });
      expect(surface.clientRejected).toEqual([]);
      // A null at the parent deletes the parent too.
      manager.ingest(
        "t1",
        "default",
        content([...base, data("/form/a", null), data("/form", null)]),
      );
      expect(surface.model.dataModel.get("/")).toEqual({});
    });

    it("rejects an omitted value or a null root value, keeping the model", () => {
      const manager = new GenerativeUISurfaceManager(ui);
      const base = [create, components, data("/", { a: 1 })];
      manager.ingest("t1", "default", content(base));
      manager.setOwnedValue(key, "/name", "Ada");
      // The agent can send what the type does not allow.
      const omitted = {
        version: "1.0",
        updateDataModel: { surfaceId: "s1", path: "/a" },
      } as unknown as A2UIOperation;
      manager.ingest(
        "t1",
        "default",
        content([...base, omitted, data("/", null)]),
      );
      const surface = manager.getSurface("t1", "s1")!;
      expect(surface.model.dataModel.get("/")).toEqual({ a: 1, name: "Ada" });
      expect(surface.clientRejected.map((r) => r.index)).toEqual([3, 4]);
    });

    it("never aliases the agent's content objects", () => {
      const manager = new GenerativeUISurfaceManager(ui);
      const value = { email: "agent@x.io", nested: { deep: true } };
      const node = { id: "note", component: "Text", text: { "@path": "/x" } };
      const ops: A2UIOperation[] = [
        create,
        {
          version: "1.0",
          updateComponents: {
            surfaceId: "s1",
            components: [
              { id: "root", component: "Column", children: ["note"] },
              node,
            ],
          },
        },
        data("/form", value),
      ];
      manager.ingest("t1", "default", content(ops));
      const surface = manager.getSurface("t1", "s1")!;
      const stored = surface.model.dataModel.get("/form") as typeof value;
      expect(stored).toEqual(value);
      expect(stored).not.toBe(value);
      expect(stored.nested).not.toBe(value.nested);
      const properties = surface.model.componentsModel.get("note")!
        .properties as { text: unknown };
      expect(properties.text).toEqual(node.text);
      expect(properties.text).not.toBe(node.text);
    });
  });

  describe("user-owned writes", () => {
    const key = surfaceKey("t1", "s1");
    const ops = [create, components, data("/form", { email: "agent@x.io" })];

    it("treats an undefined user write as a delete, and tells the agent null", () => {
      const manager = new GenerativeUISurfaceManager(ui);
      manager.ingest("t1", "default", content(ops));
      manager.setOwnedValue(key, "/form/email", undefined);
      const surface = manager.getSurface("t1", "s1")!;
      expect(surface.model.dataModel.get("/form")).toEqual({});
      // An agent write to the parent keeps the user's delete.
      const next = [...ops, data("/form", { email: "again@x.io", n: 1 })];
      manager.ingest("t1", "default", content(next));
      expect(surface.model.dataModel.get("/form")).toEqual({ n: 1 });
      // The model is not told that the user entered {}. It is told null,
      // which the protocol reads as "removed", so it sees that the path is
      // the user's and that its writes there are ignored.
      const reported = manager.describeSurfaces("t1").s1!.dataModel;
      expect(reported).toEqual({ "/form/email": null });
      expect(JSON.parse(JSON.stringify(reported))).toEqual(reported);
      // A rebuild restores the delete, not {}.
      manager.ingest("t1", "default", content(ops));
      expect(
        manager.getSurface("t1", "s1")!.model.dataModel.get("/form"),
      ).toEqual({});
    });

    it("keeps Date, Map, Set, NaN and Infinity values, and tells the agent their JSON", () => {
      const manager = new GenerativeUISurfaceManager(ui);
      manager.ingest("t1", "default", content(ops));
      const value = {
        when: new Date(86_400_000),
        map: new Map([["a", 1]]),
        set: new Set(["x"]),
        nan: Number.NaN,
        inf: Number.POSITIVE_INFINITY,
      };
      manager.setOwnedValue(key, "/form/extra", value);
      const stored = manager
        .getSurface("t1", "s1")!
        .model.dataModel.get("/form/extra") as typeof value;
      expect(stored.when).toBeInstanceOf(Date);
      expect(stored.when).not.toBe(value.when);
      expect(stored.map.get("a")).toBe(1);
      expect(stored.set.has("x")).toBe(true);
      expect(stored.nan).toBeNaN();
      expect(stored.inf).toBe(Infinity);
      expect(manager.describeSurfaces("t1").s1!.dataModel).toEqual({
        "/form/extra": {
          when: "1970-01-02T00:00:00.000Z",
          map: {},
          set: {},
          nan: null,
          inf: null,
        },
      });
    });

    it("keeps a bigint or a cyclic value, but leaves it out of the request", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const manager = new GenerativeUISurfaceManager(ui);
        manager.ingest("t1", "default", content(ops));
        type Cyclic = { inner: { n: number }; self?: Cyclic };
        const value: Cyclic = { inner: { n: 1 } };
        value.self = value;
        manager.setOwnedValue(key, "/form/cyc", value);
        manager.setOwnedValue(key, "/form/big", BigInt(10));
        const stored = manager
          .getSurface("t1", "s1")!
          .model.dataModel.get("/form/cyc") as Cyclic;
        expect(stored.self).toBe(stored);
        expect(stored).not.toBe(value);
        expect(
          manager.getSurface("t1", "s1")!.model.dataModel.get("/form/big"),
        ).toBe(BigInt(10));
        expect(warn).toHaveBeenCalledTimes(2);
        // The next request can still be built.
        expect(JSON.stringify(manager.describeSurfaces("t1"))).toBe(
          '{"s1":{"target":"chat"}}',
        );
      } finally {
        warn.mockRestore();
      }
    });

    it("never aliases the value, also after a rebuild", () => {
      const manager = new GenerativeUISurfaceManager(ui);
      manager.ingest("t1", "default", content(ops));
      const value = { first: "Ada", list: [{ n: 1 }] };
      manager.setOwnedValue(key, "/form/name", value);
      const first = manager
        .getSurface("t1", "s1")!
        .model.dataModel.get("/form/name") as typeof value;
      expect(first).not.toBe(value);
      expect(first.list[0]).not.toBe(value.list[0]);
      // Mutating the data model does not change the owned value.
      first.list[0]!.n = 99;
      manager.ingest("t1", "default", content(ops.slice(0, 2)));
      const rebuilt = manager
        .getSurface("t1", "s1")!
        .model.dataModel.get("/form/name") as typeof value;
      expect(rebuilt).toEqual({ first: "Ada", list: [{ n: 1 }] });
      expect(rebuilt).not.toBe(first);
      // Nor does mutating what describeSurfaces reports.
      const reported = manager.describeSurfaces("t1").s1!.dataModel!;
      (reported["/form/name"] as typeof value).first = "mutated";
      expect(
        manager.describeSurfaces("t1").s1!.dataModel!["/form/name"],
      ).toEqual({ first: "Ada", list: [{ n: 1 }] });
    });

    it("throws a DataCloneError for a function and writes nothing", () => {
      const manager = new GenerativeUISurfaceManager(ui);
      manager.ingest("t1", "default", content(ops));
      expect(() =>
        manager.setOwnedValue(key, "/form/fn", { run: () => 1 }),
      ).toThrow(expect.objectContaining({ name: "DataCloneError" }));
      expect(
        manager.getSurface("t1", "s1")!.model.dataModel.get("/form/fn"),
      ).toBeUndefined();
      expect(manager.describeSurfaces("t1").s1!.dataModel).toBeUndefined();
    });
  });
});
