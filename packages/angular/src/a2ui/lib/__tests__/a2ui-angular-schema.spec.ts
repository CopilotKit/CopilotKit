import { Component, input } from "@angular/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  binding,
  createCustomCatalog,
  createCustomComponent,
  createCustomFunction,
  type ContextFromSchema,
} from "../a2ui-angular-schema";

const cardSchema = z
  .object({
    title: binding(z.string()),
    delay: binding(z.number()).optional(),
  })
  .strict();

@Component({
  template: `
    <span>{{ props().title.value() }}</span>
  `,
})
class CardComponent {
  readonly props = input.required<ContextFromSchema<typeof cardSchema>>();
}

describe("binding", () => {
  it("accepts a literal value", () => {
    expect(binding(z.string()).safeParse("Paris").success).toBe(true);
  });

  it("accepts a path binding", () => {
    expect(binding(z.string()).safeParse({ path: "/flight/to" }).success).toBe(
      true,
    );
  });

  it("rejects a path binding with extra keys", () => {
    const parsed = binding(z.string()).safeParse({
      path: "/flight/to",
      extra: true,
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects values outside the wrapped schema", () => {
    expect(binding(z.string()).safeParse(42).success).toBe(false);
  });
});

describe("createCustomComponent", () => {
  it("returns the entry unchanged with full type inference", () => {
    const entry = createCustomComponent({
      name: "Card",
      description: "A card with a title.",
      schema: cardSchema,
      component: CardComponent,
    });

    expect(entry.name).toBe("Card");
    expect(entry.component).toBe(CardComponent);
    expect(entry.schema).toBe(cardSchema);
  });
});

describe("createCustomFunction", () => {
  it("returns the function unchanged and types execute from the schema", () => {
    const fn = createCustomFunction({
      name: "formatPrice",
      description: "Formats a price in euro.",
      returnType: "string",
      schema: z.object({ amount: z.number() }),
      execute: ({ amount }) => `${amount.toFixed(2)} EUR`,
    });

    expect(fn.name).toBe("formatPrice");
    expect(fn.execute({ amount: 12 })).toBe("12.00 EUR");
  });
});

describe("createCustomCatalog", () => {
  it("returns the catalog unchanged", () => {
    const entry = createCustomComponent({
      name: "Card",
      description: "A card with a title.",
      schema: cardSchema,
      component: CardComponent,
    });
    const catalog = createCustomCatalog({
      id: "https://example.com/catalogs/cards",
      components: [entry],
    });

    expect(catalog.id).toBe("https://example.com/catalogs/cards");
    expect(catalog.components).toEqual([entry]);
  });
});
