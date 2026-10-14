import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type {
  A2UIOperation,
  GenerativeUISurfaceContent,
} from "@copilotkit/shared";
import { createGenerativeUICatalog } from "../catalog";
import { GenerativeUISurfaceManager, surfaceKey } from "../surface-manager";

const Noop = () => null;
const catalog = createGenerativeUICatalog({
  id: "shop",
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
        onAddToCart: { parameters: z.object({ productId: z.string() }) },
      },
    },
  },
});

const create: A2UIOperation = {
  version: "v0.9",
  createSurface: { surfaceId: "recs", catalogId: "shop" },
};
const grid = (children: string[]): A2UIOperation => ({
  version: "v0.9",
  updateComponents: {
    surfaceId: "recs",
    components: [{ id: "root", component: "ProductGrid", children }],
  },
});
const card = (
  id: string,
  extra: Record<string, unknown> = {},
): A2UIOperation => ({
  version: "v0.9",
  updateComponents: {
    surfaceId: "recs",
    components: [
      { id, component: "ProductCard", name: `Card ${id}`, price: 10, ...extra },
    ],
  },
});
const data = (path: string, value: unknown): A2UIOperation => ({
  version: "v0.9",
  updateDataModel: { surfaceId: "recs", path, value },
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

describe("GenerativeUISurfaceManager", () => {
  it("applies operations and only the new tail on later ingests", () => {
    const manager = new GenerativeUISurfaceManager(catalog);
    manager.ingest(
      "t1",
      "default",
      content([create, grid(["c1"]), card("c1")]),
    );
    const surface = manager.getSurface("t1", "recs")!;
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
    const manager = new GenerativeUISurfaceManager(catalog);
    const listener = vi.fn();
    manager.subscribe(listener);
    const c = content([create, grid([])]);
    manager.ingest("t1", "default", c);
    const calls = listener.mock.calls.length;
    manager.ingest("t1", "default", JSON.parse(JSON.stringify(c)));
    expect(listener.mock.calls.length).toBe(calls);
  });

  it("rebuilds the surface when the operation list is not an extension", () => {
    const manager = new GenerativeUISurfaceManager(catalog);
    manager.ingest("t1", "default", content([create, grid(["c1"])]));
    const before = manager.getSurface("t1", "recs")!;
    manager.ingest("t1", "default", content([create, grid(["c9"])]));
    const after = manager.getSurface("t1", "recs")!;
    expect(after).not.toBe(before);
    expect(after.model.componentsModel.get("root")?.properties).toMatchObject({
      children: ["c9"],
    });
  });

  it("rejects an invalid operation and keeps applying its siblings", () => {
    const onOperationRejected = vi.fn();
    const manager = new GenerativeUISurfaceManager(catalog, {
      onOperationRejected,
    });
    const bad = {
      version: "v0.9",
      updateComponents: {
        surfaceId: "recs",
        components: [{ id: "x", component: "Nope" }],
      },
    } as unknown as A2UIOperation;
    manager.ingest("t1", "default", content([create, bad, grid([])]));
    const surface = manager.getSurface("t1", "recs")!;
    expect(surface.clientRejected).toEqual([
      { index: 1, reason: expect.stringContaining('unknown component "Nope"') },
    ]);
    expect(surface.model.componentsModel.get("root")).toBeDefined();
    expect(onOperationRejected).toHaveBeenCalledOnce();
  });

  it("rejects a whole update when a literal prop has the wrong type", () => {
    const manager = new GenerativeUISurfaceManager(catalog);
    manager.ingest("t1", "default", content([create, card("c1")]));
    manager.ingest(
      "t1",
      "default",
      content([create, card("c1"), card("c1", { price: "free" })]),
    );
    const surface = manager.getSurface("t1", "recs")!;
    expect(surface.model.componentsModel.get("c1")?.properties).toMatchObject({
      price: 10,
    });
    expect(surface.clientRejected[0].reason).toMatch(/price/);
  });

  describe("client rejections cover only the latest render_ui call", () => {
    const bad = card("c1", { price: "free" });

    it("clears when a new call flips the surface back to streaming", () => {
      const manager = new GenerativeUISurfaceManager(catalog);
      manager.ingest("t1", "default", content([create, bad]));
      manager.ingest(
        "t1",
        "default",
        content([create, bad], { status: "ready" }),
      );
      const surface = manager.getSurface("t1", "recs")!;
      expect(surface.clientRejected).toHaveLength(1);

      const listener = vi.fn();
      manager.subscribe(listener);
      manager.ingest(
        "t1",
        "default",
        content([create, bad], { status: "streaming" }),
      );
      expect(surface.clientRejected).toEqual([]);
      expect(listener).toHaveBeenCalledOnce();
    });

    it("clears when the server's rejected list is reset, keeping rejections from the new operations", () => {
      const manager = new GenerativeUISurfaceManager(catalog);
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
      const manager = new GenerativeUISurfaceManager(catalog);
      manager.ingest("t1", "default", content([create, bad]));
      manager.ingest("t1", "default", content([create, bad, card("c2")]));
      expect(
        manager.getSurface("t1", "recs")!.clientRejected.map((r) => r.index),
      ).toEqual([1]);
    });
  });

  it("accepts bound props and functionCall bindings to unknown functions", () => {
    const manager = new GenerativeUISurfaceManager(catalog);
    manager.ingest(
      "t1",
      "default",
      content([
        create,
        card("c1", {
          price: { path: "/p" },
          onAddToCart: { functionCall: { call: "gone", args: {} } },
        }),
      ]),
    );
    expect(manager.getSurface("t1", "recs")!.clientRejected).toEqual([]);
  });

  it("keeps app state app-owned", () => {
    const manager = new GenerativeUISurfaceManager(catalog);
    manager.setAppState("cart", { count: 1 });
    manager.ingest(
      "t1",
      "default",
      content([create, data("/app/cart/count", 99)]),
    );
    const surface = manager.getSurface("t1", "recs")!;
    expect(surface.model.dataModel.get("/app/cart/count")).toBe(1);
    expect(surface.clientRejected[0].reason).toMatch(/app-owned/);

    manager.setAppState("cart", { count: 2 });
    expect(surface.model.dataModel.get("/app/cart/count")).toBe(2);

    manager.ingest(
      "t1",
      "default",
      content([create, data("/app/cart/count", 99), data("/", { items: [] })]),
    );
    expect(surface.model.dataModel.get("/app/cart/count")).toBe(2);
    expect(manager.getAppStateKeys()).toEqual(["cart"]);
  });

  it("rejects a data write through a primitive without throwing", () => {
    const manager = new GenerativeUISurfaceManager(catalog);
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
    const manager = new GenerativeUISurfaceManager(catalog);
    manager.setAppState("cart", { count: 1 });
    const rootWrite = {
      version: "v0.9",
      updateDataModel: { surfaceId: "recs", value: { items: [] } },
    } as unknown as A2UIOperation;
    const c = content([create, grid([]), rootWrite]);
    const pristine = JSON.stringify(c);
    manager.ingest("t1", "default", c);
    const surface = manager.getSurface("t1", "recs")!;
    expect(surface.clientRejected).toEqual([]);
    expect(surface.model.dataModel.get("/app/cart/count")).toBe(1);
    expect(JSON.stringify(c)).toBe(pristine);

    const listener = vi.fn();
    manager.subscribe(listener);
    manager.ingest("t1", "default", JSON.parse(pristine));
    manager.ingest("t1", "default", c);
    expect(listener).not.toHaveBeenCalled();
    expect(manager.getSurface("t1", "recs")).toBe(surface);
  });

  it("rejects hostile paths without polluting Object.prototype", () => {
    const manager = new GenerativeUISurfaceManager(catalog);
    manager.ingest(
      "t1",
      "default",
      content([create, data("/__proto__/polluted", "yes"), data("//app/x", 1)]),
    );
    const surface = manager.getSurface("t1", "recs")!;
    expect(surface.clientRejected.map((r) => r.index)).toEqual([1, 2]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("does not throw when app state is written after the data root became a non-object", () => {
    const manager = new GenerativeUISurfaceManager(catalog);
    manager.ingest("t1", "default", content([create]));
    const surface = manager.getSurface("t1", "recs")!;
    surface.model.dataModel.set("/", 5);
    const listener = vi.fn();
    manager.subscribe(listener);
    expect(() => manager.setAppState("cart", { count: 1 })).not.toThrow();
    expect(() => manager.removeAppState("cart")).not.toThrow();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("resolves inline targets to the newest surface of the active thread", () => {
    const manager = new GenerativeUISurfaceManager(catalog);
    manager.ingest("t1", "default", content([create]));
    manager.ingest("t2", "default", content([create]));
    manager.ingest(
      "t1",
      "default",
      content(
        [
          {
            version: "v0.9",
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

  it("hides deleted surfaces", () => {
    const manager = new GenerativeUISurfaceManager(catalog);
    manager.ingest(
      "t1",
      "default",
      content([
        create,
        { version: "v0.9", deleteSurface: { surfaceId: "recs" } },
      ]),
    );
    expect(manager.getSurface("t1", "recs")).toBeUndefined();
  });

  it("reference-counts mounted targets", () => {
    const manager = new GenerativeUISurfaceManager(catalog);
    const a = manager.registerTarget("recommendations");
    const b = manager.registerTarget("recommendations");
    a();
    expect(manager.getMountedTargets()).toEqual(["recommendations"]);
    b();
    expect(manager.getMountedTargets()).toEqual([]);
  });

  it("keeps user field drafts across a surface rebuild until reset", () => {
    const manager = new GenerativeUISurfaceManager(catalog);
    const key = surfaceKey("t1", "recs");
    manager.ingest("t1", "default", content([create, grid(["c1"])]));
    manager.setField(key, "form", "email", "me@x.io");
    manager.ingest("t1", "default", content([create, grid(["c2"])]));
    expect(manager.getField(key, "form", "email")).toEqual({
      value: "me@x.io",
      dirty: true,
    });
    manager.resetField(key, "form", "email");
    expect(manager.getField(key, "form", "email")).toBeUndefined();
  });
});
