import React from "react";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createGenerativeUICatalog } from "../catalog";

const Card = () => <div />;
const Grid = () => <div />;

describe("createGenerativeUICatalog", () => {
  it("compiles props, events and slots into a serializable manifest", () => {
    const catalog = createGenerativeUICatalog({
      id: "shop",
      components: {
        ProductCard: {
          component: Card,
          description: "A product",
          props: z.object({ name: z.string(), price: z.number().optional() }),
          events: {
            onAddToCart: {
              description: "Add",
              parameters: z.object({ productId: z.string() }),
            },
          },
        },
        ProductGrid: { component: Grid, slots: { children: "multiple" } },
      },
    });
    expect(catalog.id).toBe("shop");
    expect(catalog.components.get("ProductCard")?.component).toBe(Card);
    expect(catalog.manifestComponents.ProductCard).toEqual({
      description: "A product",
      props: {
        type: "object",
        properties: { name: { type: "string" }, price: { type: "number" } },
        required: ["name"],
        additionalProperties: false,
      },
      events: {
        onAddToCart: {
          description: "Add",
          parameters: {
            type: "object",
            properties: { productId: { type: "string" } },
            required: ["productId"],
            additionalProperties: false,
          },
        },
      },
    });
    expect(catalog.manifestComponents.ProductGrid).toEqual({
      props: { type: "object", properties: {}, additionalProperties: false },
      slots: { children: "multiple" },
    });
    expect(JSON.parse(JSON.stringify(catalog.manifestComponents))).toEqual(
      catalog.manifestComponents,
    );
  });

  it("merges extended catalogs and rejects duplicate component names", () => {
    const base = createGenerativeUICatalog({
      id: "base",
      components: { Grid: { component: Grid } },
    });
    const app = createGenerativeUICatalog({
      id: "app",
      extends: [base],
      components: { Card: { component: Card } },
    });
    expect([...app.components.keys()]).toEqual(["Grid", "Card"]);
    expect(() =>
      createGenerativeUICatalog({
        id: "dup",
        extends: [base],
        components: { Grid: { component: Card } },
      }),
    ).toThrow(/"Grid" is defined more than once/);
  });

  it("rejects a key used as more than one of prop, event and slot", () => {
    expect(() =>
      createGenerativeUICatalog({
        id: "bad",
        components: {
          Card: {
            component: Card,
            props: z.object({ onAddToCart: z.string() }),
            events: { onAddToCart: { parameters: z.object({}) } },
          },
        },
      }),
    ).toThrow(
      /"onAddToCart" is declared as more than one of prop, event, slot/,
    );
  });

  it("rejects the reserved A2UI keys id and component", () => {
    expect(() =>
      createGenerativeUICatalog({
        id: "bad",
        components: {
          Card: { component: Card, props: z.object({ id: z.string() }) },
        },
      }),
    ).toThrow(/"id" is reserved/);
  });
});
