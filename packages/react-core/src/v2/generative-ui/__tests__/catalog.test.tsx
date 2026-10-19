import React from "react";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createGenerativeUI } from "../catalog";

const Card = () => <div />;
const Grid = () => <div />;

const cartSchema = z.object({ count: z.number(), total: z.number() });
const addToCart = {
  description: "Add a product",
  parameters: z.object({ productId: z.string() }),
};

function objectSchema(
  properties: Record<string, unknown>,
  required?: string[],
) {
  return {
    type: "object",
    properties,
    ...(required ? { required } : {}),
    additionalProperties: false,
  };
}

describe("createGenerativeUI", () => {
  const ui = createGenerativeUI({
    id: "shop@1",
    state: { cart: cartSchema, currency: z.string() },
    functions: { addToCart },
    components: {
      ProductCard: {
        component: Card,
        description: "A product",
        props: z.object({
          name: z.string(),
          currency: z.string(),
          inCart: z.number(),
        }),
        bind: { inCart: (state) => state.cart.count },
        events: {
          onAddToCart: {},
          onShare: {
            description: "Share",
            parameters: z.object({ channel: z.string() }),
          },
        },
      },
      ProductGrid: { component: Grid, slots: { children: "multiple" } },
    },
  });

  it("hides bound props and matched events from the manifest", () => {
    expect(ui.manifestComponents).toEqual({
      ProductCard: {
        description: "A product",
        props: objectSchema({ name: { type: "string" } }, ["name"]),
        events: {
          onShare: {
            description: "Share",
            parameters: objectSchema({ channel: { type: "string" } }, [
              "channel",
            ]),
          },
        },
      },
      ProductGrid: {
        props: objectSchema({}),
        slots: { children: "multiple" },
      },
    });
    expect(JSON.parse(JSON.stringify(ui.manifestComponents))).toEqual(
      ui.manifestComponents,
    );
  });

  it("binds props by state name and by `bind`, and events by function name", () => {
    const card = ui.components.get("ProductCard")!;
    expect(card.component).toBe(Card);
    expect(card.propKeys).toEqual(["name", "currency", "inCart"]);
    expect(Object.keys(card.selectors)).toEqual(["currency", "inCart"]);
    expect(card.eventFunctions).toEqual({ onAddToCart: "addToCart" });

    const state = { cart: { count: 3, total: 9 }, currency: "EUR" };
    expect(card.selectors.currency!(state, { name: "Mug" })).toBe("EUR");
    expect(card.selectors.inCart!(state, { name: "Mug" })).toBe(3);
  });

  it("lets `bind` win over the name rule", () => {
    const withBind = createGenerativeUI({
      id: "bind-wins@1",
      state: { count: z.number() },
      components: {
        Badge: {
          component: Card,
          props: z.object({ count: z.number() }),
          bind: { count: (state) => state.count * 10 },
        },
      },
    });
    const badge = withBind.components.get("Badge")!;
    expect(badge.selectors.count!({ count: 2 }, {})).toBe(20);
  });

  it("matches an event by its exact function name", () => {
    const exact = createGenerativeUI({
      id: "exact@1",
      functions: { addToCart },
      components: { Card: { component: Card, events: { addToCart: {} } } },
    });
    expect(exact.components.get("Card")!.eventFunctions).toEqual({
      addToCart: "addToCart",
    });
    expect(exact.manifestComponents.Card).toEqual({ props: objectSchema({}) });
  });

  it("keeps the declared functions", () => {
    expect([...ui.functions.entries()]).toEqual([["addToCart", addToCart]]);
  });
});

describe("createGenerativeUI with extends", () => {
  const widgets = createGenerativeUI({
    id: "widgets@1",
    state: { theme: z.string() },
    functions: { share: { parameters: z.object({ url: z.string() }) } },
    components: {
      Grid: { component: Grid },
      ProductCard: {
        component: Card,
        props: z.object({ name: z.string(), cart: cartSchema }),
        events: {
          onAddToCart: { parameters: z.object({ productId: z.string() }) },
        },
      },
    },
  });

  const app = createGenerativeUI({
    id: "app@1",
    extends: [widgets],
    state: { cart: cartSchema },
    functions: { addToCart },
    components: { Badge: { component: Card } },
  });

  it("merges state, functions and components, bases first", () => {
    expect([...app.state.keys()]).toEqual(["theme", "cart"]);
    expect([...app.functions.keys()]).toEqual(["share", "addToCart"]);
    expect([...app.components.keys()]).toEqual([
      "Grid",
      "ProductCard",
      "Badge",
    ]);
  });

  it("matches base components against the merged state and functions", () => {
    const card = app.components.get("ProductCard")!;
    expect(card.eventFunctions).toEqual({ onAddToCart: "addToCart" });
    expect(Object.keys(card.selectors)).toEqual(["cart"]);
    expect(app.manifestComponents.ProductCard).toEqual({
      props: objectSchema({ name: { type: "string" } }, ["name"]),
    });
    // The base itself is not changed.
    expect(widgets.manifestComponents.ProductCard?.events).toHaveProperty(
      "onAddToCart",
    );
  });
});

describe("createGenerativeUI startup errors", () => {
  const base = createGenerativeUI({
    id: "base@1",
    state: { cart: cartSchema },
    functions: { addToCart },
    components: { Grid: { component: Grid } },
  });

  it("rejects a component name from two places", () => {
    expect(() =>
      createGenerativeUI({
        id: "dup@1",
        extends: [base],
        components: { Grid: { component: Card } },
      }),
    ).toThrow(/Component "Grid" is defined more than once/);
  });

  it("rejects a state key from two places", () => {
    expect(() =>
      createGenerativeUI({
        id: "dup@1",
        extends: [base],
        state: { cart: cartSchema },
        components: {},
      }),
    ).toThrow(/State key "cart" is defined more than once/);
  });

  it("rejects a function name from two places", () => {
    expect(() =>
      createGenerativeUI({
        id: "dup@1",
        extends: [base],
        functions: { addToCart },
        components: {},
      }),
    ).toThrow(/Function "addToCart" is defined more than once/);
  });

  it("rejects a key used as more than one of prop, event and slot", () => {
    expect(() =>
      createGenerativeUI({
        id: "bad@1",
        components: {
          Card: {
            component: Card,
            props: z.object({ onShare: z.string() }),
            events: { onShare: { parameters: z.object({}) } },
          },
        },
      }),
    ).toThrow(/"onShare" is declared as more than one of prop, event, slot/);
  });

  it("rejects the reserved A2UI keys id and component", () => {
    expect(() =>
      createGenerativeUI({
        id: "bad@1",
        components: {
          Card: { component: Card, props: z.object({ id: z.string() }) },
        },
      }),
    ).toThrow(/"id" is reserved/);
  });

  it("rejects an event that matches two functions", () => {
    expect(() =>
      createGenerativeUI({
        id: "bad@1",
        functions: { onAdd: addToCart, add: addToCart },
        components: { Card: { component: Card, events: { onAdd: {} } } },
      }),
    ).toThrow(
      /"onAdd" of component "Card" matches two functions, "onAdd" and "add"/,
    );
  });

  // The next two errors are type errors too. The runtime check is for callers
  // without TypeScript.
  it("rejects an unmatched event without parameters", () => {
    expect(() =>
      createGenerativeUI({
        id: "bad@1",
        components: {
          // @ts-expect-error an unmatched event needs `parameters`.
          Card: { component: Card, events: { onShare: {} } },
        },
      }),
    ).toThrow(/"onShare" of component "Card" matches no function/);
  });

  it("rejects a bind key that is not a prop", () => {
    expect(() =>
      createGenerativeUI({
        id: "bad@1",
        state: { cart: cartSchema },
        components: {
          Card: {
            component: Card,
            props: z.object({ count: z.number() }),
            // @ts-expect-error "total" is not a prop.
            bind: { total: () => 1 },
          },
        },
      }),
    ).toThrow(/bind key "total" is not a prop of component "Card"/);
  });

  describe("writable", () => {
    /**
     * Builds a UI whose `Field` component lists `key` as writable. The config
     * is built at runtime so that each case can name a key that the types
     * reject. That is the case for callers without TypeScript.
     */
    function withWritable(key: string) {
      const writable: readonly string[] = [key];
      return () =>
        createGenerativeUI({
          id: "writable@1",
          state: { count: z.number() },
          components: {
            Field: {
              component: Card,
              props: z.object({
                value: z.string(),
                count: z.number(),
                total: z.number(),
              }),
              bind: { total: () => 1 },
              events: { onPick: { parameters: z.object({}) } },
              slots: { children: "multiple" },
              // @ts-expect-error a `string` key is wider than the prop keys.
              writable,
            },
          },
        });
    }

    it.each([
      ["not a prop", "missing", /writable key "missing" .* is not a prop/],
      ["an event", "onPick", /writable key "onPick" .* is an event/],
      ["a slot", "children", /writable key "children" .* is a slot/],
      [
        "bound by state name",
        "count",
        /writable key "count" .* is a bound prop/,
      ],
      ["bound by `bind`", "total", /writable key "total" .* is a bound prop/],
    ])("rejects a writable key that is %s", (_label, key, error) => {
      expect(withWritable(key)).toThrow(error);
    });

    it("accepts a writable model prop", () => {
      const ui = withWritable("value")();
      expect(ui.components.get("Field")!.writable).toEqual(["value"]);
    });

    it("rejects a setter name that is already a key of the component", () => {
      expect(() =>
        createGenerativeUI({
          id: "bad@1",
          components: {
            Field: {
              component: Card,
              props: z.object({ value: z.string(), setValue: z.string() }),
              writable: ["value"],
            },
          },
        }),
      ).toThrow(/setter "setValue" of writable key "value" is already a key/);
    });
  });
});

describe("overrides and omit", () => {
  const base = createGenerativeUI({
    id: "base@1",
    components: {
      Card: {
        component: Card,
        description: "A card",
        props: z.object({ title: z.string() }),
        slots: { children: "multiple" },
      },
      Grid: { component: Grid },
      Map: { component: Grid },
    },
  });
  const MyCard = () => <section />;

  it("replaces the React component of a base component and keeps what the model sees", () => {
    const app = createGenerativeUI({
      id: "app@1",
      extends: [base],
      overrides: { Card: { component: MyCard } },
      components: {},
    });
    expect(app.components.get("Card")!.component).toBe(MyCard);
    expect(app.manifestComponents.Card).toEqual(base.manifestComponents.Card);
    // The base itself is not changed.
    expect(base.components.get("Card")!.component).toBe(Card);
  });

  it("throws when an override names no component of the bases", () => {
    expect(() =>
      createGenerativeUI({
        id: "app@1",
        extends: [base],
        // @ts-expect-error "Crad" is not a component of the bases.
        overrides: { Crad: { component: MyCard } },
        components: {},
      }),
    ).toThrow(/Override "Crad" is not a component of the bases/);
  });

  it("drops omitted components from the components and from what the model sees", () => {
    const slim = base.omit(["Map"]);
    expect([...slim.components.keys()]).toEqual(["Card", "Grid"]);
    expect(Object.keys(slim.manifestComponents)).toEqual(["Card", "Grid"]);
    expect(slim.id).toBe("base@1");
    // The original keeps every component.
    expect([...base.components.keys()]).toEqual(["Card", "Grid", "Map"]);
  });

  it("extends an omitted UI, also with an override", () => {
    const app = createGenerativeUI({
      id: "app@1",
      extends: [base.omit(["Map"])],
      overrides: { Card: { component: MyCard } },
      components: { Hero: { component: Grid } },
    });
    expect([...app.components.keys()]).toEqual(["Card", "Grid", "Hero"]);
    expect(app.components.get("Card")!.component).toBe(MyCard);
  });

  it("throws when omit names an unknown component", () => {
    // @ts-expect-error "Banner" is not a component of the UI.
    expect(() => base.omit(["Banner"])).toThrow(
      /Cannot omit "Banner": it is not a component of generative UI "base@1"/,
    );
  });
});
