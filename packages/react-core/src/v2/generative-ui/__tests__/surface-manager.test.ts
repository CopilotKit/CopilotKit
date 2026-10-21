import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type {
  A2UIComponentNode,
  A2UIOperation,
  GenerativeUISurfaceContent,
} from "@copilotkit/shared";
import { createGenerativeUI } from "../catalog";
import { GenerativeUISurfaceManager, surfaceKey } from "../surface-manager";

const Noop = () => null;
const cartSchema = z.object({ count: z.number() });
const ui = createGenerativeUI({
  id: "shop",
  state: { cart: cartSchema },
  functions: {
    addToCart: { parameters: z.object({ productId: z.string() }) },
  },
  components: {
    ProductGrid: {
      component: Noop,
      props: z.object({ title: z.string().optional() }),
      slots: { children: "multiple" },
    },
    ProductCard: {
      component: Noop,
      props: z.object({ name: z.string(), price: z.number() }),
      events: {
        onShare: { parameters: z.object({ productId: z.string() }) },
      },
    },
    // `cart` is bound by name, `total` by `bind`, and `onAddToCart` matches
    // the `addToCart` function. The model sets only `label`.
    CartBadge: {
      component: Noop,
      props: z.object({
        label: z.string(),
        cart: cartSchema,
        total: z.number(),
      }),
      bind: { total: (state) => state.cart.count },
      events: { onAddToCart: {} },
    },
  },
});

const create: A2UIOperation = {
  version: "v1.0",
  createSurface: { surfaceId: "recs", catalogId: "shop" },
};
const update = (...components: A2UIComponentNode[]): A2UIOperation => ({
  version: "v1.0",
  updateComponents: { surfaceId: "recs", components },
});
const grid = (children: string[]) =>
  update({ id: "root", component: "ProductGrid", children });
const card = (id: string, extra: Record<string, unknown> = {}) =>
  update({
    id,
    component: "ProductCard",
    name: `Card ${id}`,
    price: 10,
    ...extra,
  });
const badge = (extra: Record<string, unknown> = {}) =>
  update({ id: "badge", component: "CartBadge", label: "Cart", ...extra });
const data = (path: string, value: unknown): A2UIOperation => ({
  version: "v1.0",
  updateDataModel: { surfaceId: "recs", path, value },
});
const remove: A2UIOperation = {
  version: "v1.0",
  deleteSurface: { surfaceId: "recs" },
};
const inlineCreate = (
  extra: Partial<
    Extract<A2UIOperation, { createSurface: unknown }>["createSurface"]
  >,
): A2UIOperation => ({
  version: "v1.0",
  createSurface: { surfaceId: "recs", catalogId: "shop", ...extra },
});
const content = (
  operations: A2UIOperation[],
  over: Partial<GenerativeUISurfaceContent> = {},
): GenerativeUISurfaceContent => ({
  surfaceId: "recs",
  target: "recommendations",
  catalogId: "shop",
  operations,
  status: "streaming",
  rejected: [],
  ...over,
});

/** A manager with one surface built from `operations` on thread "t1". */
function managerWith(operations: A2UIOperation[]) {
  const manager = new GenerativeUISurfaceManager(ui);
  manager.ingest("t1", "default", content(operations));
  return { manager, surface: manager.getSurface("t1", "recs")! };
}

/** A manager that reports each rejection to `onOperationRejected`. */
function managerWithRejections() {
  const onOperationRejected = vi.fn();
  const manager = new GenerativeUISurfaceManager(ui, { onOperationRejected });
  return { manager, onOperationRejected };
}

function listen(manager: GenerativeUISurfaceManager) {
  const listener = vi.fn();
  manager.subscribe(listener);
  return listener;
}

describe("GenerativeUISurfaceManager", () => {
  it("accepts the catalog id of a base catalog, and rejects an unknown one", () => {
    const shop = createGenerativeUI({
      id: "acme/shop@1",
      extends: [ui],
      components: {},
    });
    const onOperationRejected = vi.fn();
    const manager = new GenerativeUISurfaceManager(shop, {
      onOperationRejected,
    });
    manager.ingest("t1", "default", content([create]));
    manager.ingest(
      "t1",
      "default",
      content(
        [
          {
            version: "v1.0",
            createSurface: { surfaceId: "other", catalogId: "made/up@1" },
          },
        ],
        { surfaceId: "other" },
      ),
    );

    expect(manager.getSurface("t1", "recs")).toBeDefined();
    expect(onOperationRejected).toHaveBeenCalledTimes(1);
    expect(onOperationRejected.mock.calls[0][0]).toMatchObject({
      reason: expect.stringContaining('unknown catalog "made/up@1"'),
    });
  });

  it("applies operations and only the new tail on later ingests", () => {
    const { manager, surface } = managerWith([
      create,
      grid(["c1"]),
      card("c1"),
    ]);
    const firstCard = surface.model.componentsModel.get("c1");
    expect(firstCard?.properties).toMatchObject({ name: "Card c1" });

    manager.ingest(
      "t1",
      "default",
      content([create, grid(["c1"]), card("c1"), card("c2")]),
    );
    expect(manager.getSurface("t1", "recs")).toBe(surface);
    expect(surface.model.componentsModel.get("c1")).toBe(firstCard);
    expect(surface.model.componentsModel.get("c2")).toBeDefined();
  });

  it("ingesting identical content twice is a no-op", () => {
    const manager = new GenerativeUISurfaceManager(ui);
    const listener = listen(manager);
    const c = content([create, grid([])]);
    manager.ingest("t1", "default", c);
    const calls = listener.mock.calls.length;
    manager.ingest("t1", "default", JSON.parse(JSON.stringify(c)));
    expect(listener.mock.calls.length).toBe(calls);
  });

  it("rebuilds the surface when the operation list is not an extension", () => {
    const { manager, surface: before } = managerWith([create, grid(["c1"])]);
    manager.ingest("t1", "default", content([create, grid(["c9"])]));
    const after = manager.getSurface("t1", "recs")!;
    expect(after).not.toBe(before);
    expect(after.model.componentsModel.get("root")?.properties).toMatchObject({
      children: ["c9"],
    });
  });

  it("rejects an invalid operation and keeps applying its siblings", () => {
    const { manager, onOperationRejected } = managerWithRejections();
    const bad = update({ id: "x", component: "Nope" });
    manager.ingest("t1", "default", content([create, bad, grid([])]));
    const surface = manager.getSurface("t1", "recs")!;
    expect(surface.clientRejected).toEqual([
      { index: 1, reason: expect.stringContaining('unknown component "Nope"') },
    ]);
    expect(surface.model.componentsModel.get("root")).toBeDefined();
    expect(onOperationRejected).toHaveBeenCalledOnce();
  });

  it("rejects a whole update when a literal prop has the wrong type", () => {
    const { manager, surface } = managerWith([create, card("c1")]);
    manager.ingest(
      "t1",
      "default",
      content([create, card("c1"), card("c1", { price: "free" })]),
    );
    expect(surface.model.componentsModel.get("c1")?.properties).toMatchObject({
      price: 10,
    });
    expect(surface.clientRejected[0].reason).toMatch(/price/);
  });

  describe("client rejections cover only the latest render_ui call", () => {
    const bad = card("c1", { price: "free" });

    it("clears when a new call flips the surface back to streaming", () => {
      const { manager, surface } = managerWith([create, bad]);
      manager.ingest(
        "t1",
        "default",
        content([create, bad], { status: "ready" }),
      );
      expect(surface.clientRejected).toHaveLength(1);

      const listener = listen(manager);
      manager.ingest(
        "t1",
        "default",
        content([create, bad], { status: "streaming" }),
      );
      expect(surface.clientRejected).toEqual([]);
      expect(listener).toHaveBeenCalledOnce();
    });

    it("clears when the server's rejected list is reset, keeping rejections from the new operations", () => {
      const manager = new GenerativeUISurfaceManager(ui);
      const serverReject = [{ index: 2, reason: "unknown component" }];
      manager.ingest(
        "t1",
        "default",
        content([create, bad], { status: "ready", rejected: serverReject }),
      );
      const surface = manager.getSurface("t1", "recs")!;
      expect(surface.clientRejected.map((r) => r.index)).toEqual([1]);

      // The whole next call arrives in one ingest, so status is "ready" again.
      manager.ingest(
        "t1",
        "default",
        content([create, bad, card("c2"), card("c3", { price: "x" })], {
          status: "ready",
        }),
      );
      expect(surface.clientRejected.map((r) => r.index)).toEqual([3]);
    });

    it("keeps rejections while the same call is still streaming", () => {
      const { manager } = managerWith([create, bad]);
      manager.ingest("t1", "default", content([create, bad, card("c2")]));
      expect(
        manager.getSurface("t1", "recs")!.clientRejected.map((r) => r.index),
      ).toEqual([1]);
    });
  });

  it("accepts @path and @index props, and functionCall bindings to unknown functions", () => {
    const { surface } = managerWith([
      create,
      card("c1", {
        name: { "@path": "/name" },
        price: { "@call": "@index", args: { offset: 1 } },
        onShare: { functionCall: { "@call": "gone", args: {} } },
      }),
    ]);
    expect(surface.clientRejected).toEqual([]);
  });

  describe("v1.0 operations", () => {
    it("applies the data model and the components of an inline createSurface", () => {
      const { surface } = managerWith([
        inlineCreate({
          dataModel: { title: "Picks" },
          components: [
            {
              id: "root",
              component: "ProductGrid",
              title: { "@path": "/title" },
              children: [],
            },
          ],
        }),
      ]);
      expect(surface.clientRejected).toEqual([]);
      expect(surface.model.dataModel.get("/")).toEqual({ title: "Picks" });
      expect(surface.model.componentsModel.get("root")?.properties).toEqual({
        title: { "@path": "/title" },
        children: [],
      });
    });

    it("drops a model value for a bound prop in an inline createSurface", () => {
      const { surface } = managerWith([
        inlineCreate({
          components: [
            { id: "badge", component: "CartBadge", label: "Cart", total: 99 },
          ],
        }),
      ]);
      expect(surface.clientRejected).toEqual([]);
      expect(surface.model.componentsModel.get("badge")?.properties).toEqual({
        label: "Cart",
      });
    });

    it("does not make a surface whose inline createSurface is rejected", () => {
      const { manager, onOperationRejected } = managerWithRejections();
      const badCard = { id: "c1", component: "ProductCard", name: "A" };
      manager.ingest(
        "t1",
        "default",
        content([
          inlineCreate({
            dataModel: { title: "Picks" },
            components: [{ ...badCard, price: "free" }],
          }),
          grid([]),
        ]),
      );
      expect(manager.getSurface("t1", "recs")).toBeUndefined();
      expect(onOperationRejected.mock.calls).toEqual([
        [
          {
            surfaceId: "recs",
            index: 0,
            reason: expect.stringMatching(/price/),
          },
        ],
        [
          {
            surfaceId: "recs",
            index: 1,
            reason: 'surface "recs" does not exist; send createSurface first',
          },
        ],
      ]);
    });

    it("deletes the key at the path for a null value", () => {
      const { surface } = managerWith([
        create,
        data("/form", { email: "a@x.io", name: "Ada" }),
        data("/form/name", null),
      ]);
      expect(surface.clientRejected).toEqual([]);
      expect(surface.model.dataModel.get("/form")).toEqual({ email: "a@x.io" });
    });

    it("ignores a callRendererFunction in the surface content", () => {
      const call: A2UIOperation = {
        version: "v1.0",
        callRendererFunction: {
          functionCallId: "f1",
          callFunction: { "@call": "addToCart", args: { productId: "p1" } },
        },
      };
      const { surface } = managerWith([create, call, grid([])]);
      expect(surface.clientRejected).toEqual([]);
      expect(surface.model.componentsModel.get("root")).toBeDefined();
    });
  });

  describe("a surface id is used once", () => {
    it.each([
      ["exists", [create, grid([]), create], 'surface "recs" already exists'],
      [
        "was deleted",
        [create, remove, create],
        'surface id "recs" was used before; use a new surfaceId',
      ],
    ])(
      "rejects a later createSurface when the surface %s",
      (_name, operations, reason) => {
        const { manager, onOperationRejected } = managerWithRejections();
        manager.ingest("t1", "default", content(operations));
        expect(onOperationRejected.mock.calls).toEqual([
          [{ surfaceId: "recs", index: 2, reason }],
        ]);
      },
    );

    it("rejects a createSurface after delete that comes in new content", () => {
      const { manager, onOperationRejected } = managerWithRejections();
      manager.ingest("t1", "default", content([create, grid([]), remove]));
      // The tool transport replaces the content of the surface message.
      manager.ingest("t1", "default", content([create, grid([])]));
      expect(manager.getSurface("t1", "recs")).toBeUndefined();
      expect(onOperationRejected).toHaveBeenCalledWith({
        surfaceId: "recs",
        index: 0,
        reason: 'surface id "recs" was used before; use a new surfaceId',
      });
    });

    it("builds a deleted surface again without a rejection when the content replays the delete", () => {
      const { manager, onOperationRejected } = managerWithRejections();
      const operations = [create, grid([]), remove];
      manager.ingest("t1", "default", content(operations));
      // The markdown source starts a surface again with an empty content.
      manager.ingest("t1", "default", content([]));
      manager.ingest("t1", "default", content(operations));
      expect(onOperationRejected).not.toHaveBeenCalled();
      expect(manager.getSurface("t1", "recs")).toBeUndefined();
    });
  });

  describe("bound props and matched events", () => {
    it("accepts a node that leaves out a required bound prop", () => {
      const { surface } = managerWith([create, badge()]);
      expect(surface.clientRejected).toEqual([]);
      expect(surface.model.componentsModel.get("badge")?.properties).toEqual({
        label: "Cart",
      });
    });

    it("drops a model value for a bound prop and a binding for a matched event", () => {
      const { surface } = managerWith([
        create,
        badge({
          cart: { count: 99 },
          total: 99,
          onAddToCart: { functionCall: { "@call": "addToCart", args: {} } },
        }),
      ]);
      expect(surface.clientRejected).toEqual([]);
      expect(surface.model.componentsModel.get("badge")?.properties).toEqual({
        label: "Cart",
      });
    });

    it("still rejects a wrong model-set prop next to a dropped bound prop", () => {
      const { surface } = managerWith([create, badge({ label: 5, total: 1 })]);
      expect(surface.clientRejected).toEqual([
        { index: 1, reason: expect.stringMatching(/label/) },
      ]);
      expect(surface.model.componentsModel.get("badge")).toBeUndefined();
    });

    it("does not change the received operation", () => {
      const op = badge({ total: 99 });
      const pristine = JSON.stringify(op);
      managerWith([create, op]);
      expect(JSON.stringify(op)).toBe(pristine);
    });
  });

  describe("state", () => {
    it("starts empty", () => {
      const manager = new GenerativeUISurfaceManager(ui);
      expect(manager.getState()).toEqual({});
    });

    it("setState makes a new object and notifies", () => {
      const manager = new GenerativeUISurfaceManager(ui);
      const before = manager.getState();
      const listener = listen(manager);
      manager.setState("cart", { count: 1 });
      expect(manager.getState()).toEqual({ cart: { count: 1 } });
      expect(manager.getState()).not.toBe(before);
      expect(before).toEqual({});
      expect(listener).toHaveBeenCalledOnce();
    });

    it("returns the same object until a key changes", () => {
      const manager = new GenerativeUISurfaceManager(ui);
      const cart = { count: 1 };
      manager.setState("cart", cart);
      const snapshot = manager.getState();
      const listener = listen(manager);
      manager.setState("cart", cart);
      manager.removeState("missing");
      expect(manager.getState()).toBe(snapshot);
      expect(listener).not.toHaveBeenCalled();
    });

    it("setState with undefined adds the key", () => {
      const manager = new GenerativeUISurfaceManager(ui);
      const listener = listen(manager);
      manager.setState("cart", undefined);
      expect(Object.keys(manager.getState())).toEqual(["cart"]);
      expect(listener).toHaveBeenCalledOnce();
    });

    it("removeState makes a new object without the key and notifies", () => {
      const manager = new GenerativeUISurfaceManager(ui);
      manager.setState("cart", { count: 1 });
      manager.setState("user", "ada");
      const before = manager.getState();
      const listener = listen(manager);
      manager.removeState("cart");
      expect(manager.getState()).toEqual({ user: "ada" });
      expect(before).toEqual({ cart: { count: 1 }, user: "ada" });
      expect(listener).toHaveBeenCalledOnce();
    });

    it("never writes state into a surface's data model", () => {
      const manager = new GenerativeUISurfaceManager(ui);
      manager.setState("cart", { count: 1 });
      manager.ingest(
        "t1",
        "default",
        content([create, data("/", { items: [] })]),
      );
      const surface = manager.getSurface("t1", "recs")!;
      manager.setState("cart", { count: 2 });
      expect(surface.model.dataModel.get("/")).toEqual({ items: [] });
    });
  });

  it("rejects a data write through a primitive without throwing", () => {
    const manager = new GenerativeUISurfaceManager(ui);
    expect(() =>
      manager.ingest(
        "t1",
        "default",
        content([create, data("/a", 1), data("/a/b", 2), grid([])]),
      ),
    ).not.toThrow();
    const surface = manager.getSurface("t1", "recs")!;
    expect(surface.clientRejected.map((r) => r.index)).toEqual([2]);
    expect(surface.model.componentsModel.get("root")).toBeDefined();
  });

  it("re-ingesting content that ends in a root write is a no-op and does not mutate the content", () => {
    const manager = new GenerativeUISurfaceManager(ui);
    const rootWrite: A2UIOperation = {
      version: "v1.0",
      updateDataModel: { surfaceId: "recs", value: { items: [] } },
    };
    const c = content([create, grid([]), rootWrite]);
    const pristine = JSON.stringify(c);
    manager.ingest("t1", "default", c);
    const surface = manager.getSurface("t1", "recs")!;
    expect(surface.clientRejected).toEqual([]);
    expect(JSON.stringify(c)).toBe(pristine);

    const listener = listen(manager);
    manager.ingest("t1", "default", JSON.parse(pristine));
    manager.ingest("t1", "default", c);
    expect(listener).not.toHaveBeenCalled();
    expect(manager.getSurface("t1", "recs")).toBe(surface);
  });

  it("rejects hostile paths without polluting Object.prototype", () => {
    const { surface } = managerWith([
      create,
      data("/__proto__/polluted", "yes"),
      data("//app/x", 1),
    ]);
    expect(surface.clientRejected.map((r) => r.index)).toEqual([1, 2]);
    expect(Object.hasOwn(Object.prototype, "polluted")).toBe(false);
  });

  it("resolves inline targets to the newest surface of the active thread", () => {
    const manager = new GenerativeUISurfaceManager(ui);
    manager.ingest("t1", "default", content([create]));
    manager.ingest("t2", "default", content([create]));
    manager.ingest(
      "t1",
      "default",
      content(
        [
          {
            version: "v1.0",
            createSurface: { surfaceId: "recs2", catalogId: "shop" },
          },
        ],
        { surfaceId: "recs2" },
      ),
    );
    manager.setActiveThread("t1");
    expect(manager.getSurfaceForTarget("recommendations")?.surfaceId).toBe(
      "recs2",
    );
    expect(manager.getSurfaceForTarget("chat")).toBeUndefined();
    expect(manager.describeSurfaces("t1")).toEqual({
      recs: { target: "recommendations" },
      recs2: { target: "recommendations" },
    });
  });

  describe("rejections in describeSurfaces", () => {
    it("lists the reported and the browser rejections as lines", () => {
      const manager = new GenerativeUISurfaceManager(ui);
      manager.ingest(
        "t1",
        "default",
        content([create, data("/a", 1), data("/a/b", 2)], {
          rejected: [{ index: 5, reason: "unknown component Foo" }],
        }),
      );
      expect(manager.describeSurfaces("t1")).toEqual({
        recs: {
          target: "recommendations",
          rejected: [
            "operation 5: unknown component Foo",
            expect.stringMatching(/^operation 2: \S/),
          ],
        },
      });
    });

    it("keeps at most 20 lines of at most 500 characters", () => {
      const manager = new GenerativeUISurfaceManager(ui);
      const rejected = Array.from({ length: 25 }, (_, index) => ({
        index,
        reason: "x".repeat(600),
      }));
      manager.ingest("t1", "default", content([create], { rejected }));
      const lines = manager.describeSurfaces("t1").recs.rejected ?? [];
      expect(lines).toHaveLength(20);
      expect(lines[19]).toBe(`operation 19: ${"x".repeat(486)}`);
    });
  });

  it("hides deleted surfaces", () => {
    const { manager } = managerWith([create, remove]);
    expect(manager.getSurface("t1", "recs")).toBeUndefined();
  });

  describe("targets", () => {
    it("reference-counts mounts, and a second unmount call does nothing", () => {
      const manager = new GenerativeUISurfaceManager(ui);
      const a = manager.registerTarget("recommendations");
      const b = manager.registerTarget("recommendations");
      a();
      a();
      expect(manager.getMountedTargets()).toEqual([{ id: "recommendations" }]);
      b();
      expect(manager.getMountedTargets()).toEqual([]);
    });

    it("lists the description and leaves it out when absent", () => {
      const manager = new GenerativeUISurfaceManager(ui);
      manager.registerTarget("recommendations", {
        description: "Next to the product list.",
      });
      manager.registerTarget("sidebar");
      expect(manager.getMountedTargets()).toEqual([
        { id: "recommendations", description: "Next to the product list." },
        { id: "sidebar" },
      ]);
    });

    it("keeps the first mount's description, then one from a mount that is still mounted", () => {
      const manager = new GenerativeUISurfaceManager(ui);
      const first = manager.registerTarget("recommendations", {
        description: "First",
      });
      manager.registerTarget("recommendations", { description: "Second" });
      expect(manager.getMountedTargets()).toEqual([
        { id: "recommendations", description: "First" },
      ]);
      first();
      expect(manager.getMountedTargets()).toEqual([
        { id: "recommendations", description: "Second" },
      ]);
    });

    it("a mount without a description does not hide a later description", () => {
      const manager = new GenerativeUISurfaceManager(ui);
      manager.registerTarget("recommendations");
      manager.registerTarget("recommendations", { description: "Second" });
      expect(manager.getMountedTargets()).toEqual([
        { id: "recommendations", description: "Second" },
      ]);
    });

    it("lists the components of the earliest mount that has them", () => {
      const manager = new GenerativeUISurfaceManager(ui);
      manager.registerTarget("recommendations");
      const first = manager.registerTarget("recommendations", {
        components: ["ProductGrid"],
      });
      manager.registerTarget("recommendations", {
        components: ["ProductGrid", "ProductCard"],
      });
      expect(manager.getMountedTargets()).toEqual([
        { id: "recommendations", components: ["ProductGrid"] },
      ]);
      first();
      expect(manager.getMountedTargets()).toEqual([
        { id: "recommendations", components: ["ProductGrid", "ProductCard"] },
      ]);
    });
  });

  describe("a target that limits its components", () => {
    /** A manager whose "recommendations" target takes only `components`. */
    function limitedManager(components: string[]) {
      const { manager, onOperationRejected } = managerWithRejections();
      manager.registerTarget("recommendations", { components });
      return { manager, onOperationRejected };
    }

    it("applies the components of the list", () => {
      const { manager } = limitedManager(["ProductGrid", "ProductCard"]);
      manager.ingest(
        "t1",
        "default",
        content([create, grid(["c1"]), card("c1")]),
      );
      const surface = manager.getSurface("t1", "recs")!;
      expect(surface.clientRejected).toEqual([]);
      expect(surface.model.componentsModel.get("c1")).toBeDefined();
    });

    it("rejects a component outside the list, also in an inline createSurface", () => {
      const { manager, onOperationRejected } = limitedManager(["ProductGrid"]);
      manager.ingest(
        "t1",
        "default",
        content([create, grid(["c1"]), card("c1")]),
      );
      const surface = manager.getSurface("t1", "recs")!;
      const reason =
        'component "c1": "ProductCard" is not allowed in target "recommendations"; use one of: ProductGrid';
      expect(surface.clientRejected).toEqual([{ index: 2, reason }]);
      expect(surface.model.componentsModel.get("c1")).toBeUndefined();
      expect(onOperationRejected).toHaveBeenCalledWith({
        surfaceId: "recs",
        index: 2,
        reason,
      });

      manager.ingest(
        "t2",
        "default",
        content([
          inlineCreate({
            components: [
              { id: "root", component: "ProductCard", name: "A", price: 1 },
            ],
          }),
        ]),
      );
      expect(manager.getSurface("t2", "recs")).toBeUndefined();
    });

    it("uses the list of the earliest mount", () => {
      const { manager } = limitedManager(["ProductGrid"]);
      manager.registerTarget("recommendations", {
        components: ["ProductGrid", "ProductCard"],
      });
      manager.ingest("t1", "default", content([create, card("c1")]));
      expect(manager.getSurface("t1", "recs")!.clientRejected).toEqual([
        {
          index: 1,
          reason: expect.stringContaining('"ProductCard" is not allowed'),
        },
      ]);
    });
  });

  describe("user-owned paths", () => {
    const key = surfaceKey("t1", "recs");

    /** Ingests `operations` after the ones the surface already has. */
    function append(
      manager: GenerativeUISurfaceManager,
      before: A2UIOperation[],
      ...operations: A2UIOperation[]
    ) {
      const all = [...before, ...operations];
      manager.ingest("t1", "default", content(all));
      return all;
    }

    it("writes the value and ignores agent writes to the path or below it", () => {
      const ops = [create, data("/form", { email: "agent@x.io" })];
      const { manager, surface } = managerWith(ops);
      manager.setOwnedValue(key, "/form/email", "me@x.io");
      expect(surface.model.dataModel.get("/form/email")).toBe("me@x.io");

      append(manager, ops, data("/form/email", "other@x.io"));
      expect(surface.model.dataModel.get("/form/email")).toBe("me@x.io");
      expect(surface.clientRejected).toEqual([]);
    });

    it("keeps the owned child when the agent writes a parent, and applies the rest", () => {
      const ops = [create, data("/form", { email: "agent@x.io" })];
      const { manager, surface } = managerWith(ops);
      manager.setOwnedValue(key, "/form/email", "me@x.io");

      const next = append(
        manager,
        ops,
        data("/form", { email: "other@x.io", name: "Ada" }),
      );
      expect(surface.model.dataModel.get("/form")).toEqual({
        email: "me@x.io",
        name: "Ada",
      });

      append(manager, next, {
        version: "v1.0",
        updateDataModel: { surfaceId: "recs", value: { title: "New" } },
      });
      expect(surface.model.dataModel.get("/")).toEqual({
        title: "New",
        form: { email: "me@x.io" },
      });
    });

    it("keeps owned values when the surface is rebuilt", () => {
      const { manager } = managerWith([create, data("/name", "agent")]);
      manager.setOwnedValue(key, "/name", "me");
      manager.ingest("t1", "default", content([create, data("/name", "new")]));
      expect(
        manager.getSurface("t1", "recs")!.model.dataModel.get("/"),
      ).toEqual({ name: "me" });
    });

    it("keeps the owned value when the agent deletes its parent with null", () => {
      const ops = [create, data("/form", { email: "agent@x.io", name: "Ada" })];
      const { manager, surface } = managerWith(ops);
      manager.setOwnedValue(key, "/form/email", "me@x.io");

      append(manager, ops, data("/form", null));
      expect(surface.model.dataModel.get("/form")).toEqual({
        email: "me@x.io",
      });
      expect(surface.clientRejected).toEqual([]);
    });

    it("lists the owned values in describeSurfaces", () => {
      const { manager } = managerWith([create]);
      manager.setOwnedValue(key, "/form/email", "me@x.io");
      expect(manager.describeSurfaces("t1")).toEqual({
        recs: {
          target: "recommendations",
          dataModel: { "/form/email": "me@x.io" },
        },
      });
    });

    it("throws on a prototype path and does not own it", () => {
      const { manager } = managerWith([create]);
      expect(() =>
        manager.setOwnedValue(key, "/__proto__/polluted", "yes"),
      ).toThrow(/"__proto__" is not allowed/);
      expect(Object.hasOwn(Object.prototype, "polluted")).toBe(false);
      expect(manager.describeSurfaces("t1")).toEqual({
        recs: { target: "recommendations" },
      });
    });
  });
});
