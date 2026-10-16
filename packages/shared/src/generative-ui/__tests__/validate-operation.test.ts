import { describe, expect, it } from "vitest";
import { validateOperation } from "../validate-operation";
import type { GenerativeUIManifest } from "../types";

const manifest: Pick<GenerativeUIManifest, "catalogId" | "components"> = {
  catalogId: "shop",
  components: {
    ProductGrid: {
      props: { type: "object", properties: { title: { type: "string" } } },
      slots: { children: "multiple" },
    },
    ProductCard: {
      props: {
        type: "object",
        properties: { name: { type: "string" }, price: { type: "number" } },
        required: ["name", "price"],
      },
      events: { onAddToCart: { parameters: { type: "object" } } },
    },
    Frame: {
      props: { type: "object", properties: {} },
      slots: { child: "single" },
    },
  },
};
const functions = { addToCart: { parameters: { type: "object" } } };
const knownSurfaces = new Set(["s1"]);
const update = (...components: unknown[]) => ({
  version: "v0.9",
  updateComponents: { surfaceId: "s1", components },
});
const setData = (fields: { path?: string; value?: unknown }) => ({
  version: "v0.9",
  updateDataModel: { surfaceId: "s1", ...fields },
});
const reasonOf = (op: unknown, withFunctions = false) => {
  const result = validateOperation(op, {
    manifest,
    knownSurfaces,
    ...(withFunctions ? { functions } : {}),
  });
  return result.ok ? "ok" : result.reason;
};

describe("validateOperation", () => {
  it("accepts createSurface for a new surface in the manifest catalog", () => {
    expect(
      reasonOf({
        version: "v0.9",
        createSurface: { surfaceId: "s2", catalogId: "shop" },
      }),
    ).toBe("ok");
  });

  it("rejects createSurface for an existing surface or a foreign catalog", () => {
    expect(
      reasonOf({
        version: "v0.9",
        createSurface: { surfaceId: "s1", catalogId: "shop" },
      }),
    ).toMatch(/already exists/);
    expect(
      reasonOf({
        version: "v0.9",
        createSurface: { surfaceId: "s2", catalogId: "other" },
      }),
    ).toMatch(/unknown catalog/);
  });

  it("rejects updates to surfaces that do not exist", () => {
    expect(
      reasonOf({
        version: "v0.9",
        updateComponents: {
          surfaceId: "missing",
          components: [{ id: "root", component: "ProductGrid" }],
        },
      }),
    ).toMatch(/does not exist/);
  });

  it("rejects wrong versions and ops with zero or several kinds", () => {
    expect(
      reasonOf({ version: "v1.0", deleteSurface: { surfaceId: "s1" } }),
    ).toMatch(/version/);
    expect(reasonOf({ version: "v0.9" })).toMatch(/exactly one/);
    expect(
      reasonOf({
        version: "v0.9",
        deleteSurface: { surfaceId: "s1" },
        updateDataModel: { surfaceId: "s1" },
      }),
    ).toMatch(/exactly one/);
  });

  it("accepts a grid with child references and a card with literal and bound props", () => {
    expect(
      reasonOf(
        update(
          {
            id: "root",
            component: "ProductGrid",
            title: "Picks",
            children: ["c1", "c2"],
          },
          {
            id: "c1",
            component: "ProductCard",
            name: "Headphones",
            price: { path: "/prices/c1" },
            onAddToCart: {
              functionCall: { call: "addToCart", args: { productId: "p1" } },
            },
          },
        ),
        true,
      ),
    ).toBe("ok");
  });

  it("rejects unknown components, unknown props and missing required props", () => {
    expect(reasonOf(update({ id: "x", component: "Nope" }))).toMatch(
      /unknown component "Nope"/,
    );
    expect(
      reasonOf(
        update({
          id: "c1",
          component: "ProductCard",
          name: "A",
          price: 1,
          color: "red",
        }),
      ),
    ).toMatch(/unknown prop "color"/);
    expect(
      reasonOf(update({ id: "c1", component: "ProductCard", name: "A" })),
    ).toMatch(/missing required prop "price"/);
  });

  it("rejects slot values that are not id references or reference the node itself", () => {
    expect(
      reasonOf(
        update({ id: "root", component: "ProductGrid", children: "c1" }),
      ),
    ).toMatch(/array/);
    expect(
      reasonOf(
        update({ id: "root", component: "ProductGrid", children: ["root"] }),
      ),
    ).toMatch(/its own child/);
    expect(
      reasonOf(update({ id: "f", component: "Frame", child: ["a"] })),
    ).toMatch(/component ids/);
  });

  it("accepts a template with an absolute or a relative path in a multiple slot", () => {
    for (const path of ["/products", "items/0/variants"]) {
      expect(
        reasonOf(
          update({
            id: "root",
            component: "ProductGrid",
            children: { componentId: "card", path },
          }),
        ),
      ).toBe("ok");
    }
  });

  it("rejects a template in a single slot", () => {
    expect(
      reasonOf(
        update({
          id: "f",
          component: "Frame",
          child: { componentId: "card", path: "/products" },
        }),
      ),
    ).toBe(
      'component "f": child: a template { "componentId", "path" } is only allowed in a "multiple" slot',
    );
  });

  it("rejects template paths with forbidden or empty segments", () => {
    const templateReason = (path: string) =>
      reasonOf(
        update({
          id: "root",
          component: "ProductGrid",
          children: { componentId: "card", path },
        }),
      );
    expect(templateReason("/__proto__/x")).toBe(
      'component "root": children: path segment "__proto__" is not allowed in template path',
    );
    for (const path of ["/", "a//b", "items/"]) {
      expect(templateReason(path)).toBe(
        'component "root": children: template path must not contain empty segments',
      );
    }
  });

  it("rejects templates without a component id, with extra keys, or that repeat the node itself", () => {
    const slotReason = (children: unknown) =>
      reasonOf(update({ id: "root", component: "ProductGrid", children }));
    expect(slotReason({ componentId: "", path: "/products" })).toMatch(
      /template componentId must be a component id/,
    );
    expect(slotReason({ componentId: "card", path: "" })).toMatch(
      /template path must be a JSON pointer or a relative path/,
    );
    expect(
      slotReason({ componentId: "card", path: "/products", limit: 3 }),
    ).toMatch(/takes only "componentId" and "path"/);
    expect(slotReason({ componentId: "root", path: "/products" })).toMatch(
      /its own child/,
    );
  });

  it("checks function names only when the function list is provided", () => {
    const op = update({
      id: "c1",
      component: "ProductCard",
      name: "A",
      price: 1,
      onAddToCart: { functionCall: { call: "removeFromCart" } },
    });
    expect(reasonOf(op, true)).toMatch(
      /function "removeFromCart" is not exposed/,
    );
    expect(reasonOf(op, false)).toBe("ok");
  });

  it("rejects malformed action bindings", () => {
    expect(
      reasonOf(
        update({
          id: "c1",
          component: "ProductCard",
          name: "A",
          price: 1,
          onAddToCart: "addToCart",
        }),
      ),
    ).toMatch(/action object/);
    expect(
      reasonOf(
        update({
          id: "c1",
          component: "ProductCard",
          name: "A",
          price: 1,
          onAddToCart: { event: {} },
        }),
      ),
    ).toMatch(/event.name/);
  });

  it("rejects function calls inside data props", () => {
    expect(
      reasonOf(
        update({
          id: "c1",
          component: "ProductCard",
          name: { call: "addToCart", args: {} },
          price: 1,
        }),
      ),
    ).toMatch(/only allowed in event props/);
  });

  it("rejects duplicate ids within one update", () => {
    expect(
      reasonOf(
        update(
          { id: "root", component: "ProductGrid" },
          { id: "root", component: "ProductGrid" },
        ),
      ),
    ).toMatch(/appears twice/);
  });

  it("accepts writes under /app like any other data-model path", () => {
    expect(reasonOf(setData({ path: "/app/cart", value: 1 }))).toBe("ok");
    expect(reasonOf(setData({ path: "/", value: { app: {} } }))).toBe("ok");
  });

  it("rejects prototype-polluting path segments", () => {
    for (const path of [
      "/__proto__/x",
      "/a/constructor/b",
      "/prototype",
      "/a/~0/__proto__",
    ]) {
      expect(reasonOf(setData({ path, value: 1 }))).toMatch(/not allowed/);
    }
  });

  it("rejects empty path segments", () => {
    for (const path of ["//a/b", "/a//b", "/a/"]) {
      expect(reasonOf(setData({ path, value: 1 }))).toMatch(/empty segments/);
    }
  });

  it("rejects root writes whose value is not a JSON object", () => {
    for (const value of [5, [1], "s", null, undefined]) {
      expect(reasonOf(setData({ path: "/", value }))).toMatch(
        /must be a JSON object/,
      );
      expect(reasonOf(setData({ value }))).toMatch(/must be a JSON object/);
    }
    expect(reasonOf(setData({ value: { items: [] } }))).toBe("ok");
  });

  it("rejects component types that only exist on Object.prototype without throwing", () => {
    expect(() =>
      reasonOf(update({ id: "x", component: "constructor" })),
    ).not.toThrow();
    expect(reasonOf(update({ id: "x", component: "constructor" }))).toMatch(
      /unknown component "constructor"/,
    );
    expect(reasonOf(update({ id: "x", component: "__proto__" }))).toMatch(
      /unknown component "__proto__"/,
    );
  });

  it("does not treat an inherited Object.prototype key as an event prop", () => {
    expect(
      reasonOf(
        update({
          id: "c1",
          component: "ProductCard",
          name: "A",
          price: 1,
          toString: "x",
        }),
      ),
    ).toMatch(/unknown prop "toString"/);
  });

  it("does not treat an inherited Object.prototype key as a slot", () => {
    expect(
      reasonOf(
        update({ id: "root", component: "ProductGrid", constructor: ["c1"] }),
      ),
    ).toMatch(/unknown prop "constructor"/);
  });

  it("does not expose inherited Object.prototype keys as functions", () => {
    expect(
      reasonOf(
        update({
          id: "c1",
          component: "ProductCard",
          name: "A",
          price: 1,
          onAddToCart: { functionCall: { call: "toString" } },
        }),
        true,
      ),
    ).toMatch(/function "toString" is not exposed/);
  });
});
