import { Component, input } from "@angular/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  A2UI_CATALOG_CONTEXT_DESCRIPTION,
  catalogIdToContextEntry,
  catalogToContextEntry,
} from "../a2ui-angular-catalog-context";
import {
  binding,
  createCustomComponent,
  type ContextFromSchema,
} from "../a2ui-angular-schema";

const CATALOG_ID = "https://example.com/catalogs/test-catalog";

const cardSchema = z
  .object({
    title: binding(z.string()),
  })
  .strict();

@Component({ template: `` })
class CardComponent {
  readonly props = input.required<ContextFromSchema<typeof cardSchema>>();
}

describe("catalogIdToContextEntry", () => {
  it("carries only the catalog id", () => {
    const entry = catalogIdToContextEntry(CATALOG_ID);

    expect(entry.description).toBe(A2UI_CATALOG_CONTEXT_DESCRIPTION);
    expect(JSON.parse(entry.value)).toEqual({
      catalogId: CATALOG_ID,
      components: {},
    });
  });
});

describe("catalogToContextEntry", () => {
  it("serializes component metadata with inline JSON schemas", () => {
    const entry = catalogToContextEntry({
      id: CATALOG_ID,
      components: [
        createCustomComponent({
          name: "Card",
          description: "A card with a title.",
          schema: cardSchema,
          component: CardComponent,
        }),
      ],
    });

    expect(entry.description).toBe(A2UI_CATALOG_CONTEXT_DESCRIPTION);

    const value = JSON.parse(entry.value);
    expect(value.catalogId).toBe(CATALOG_ID);
    expect(value.components.Card.description).toBe("A card with a title.");
    expect(value.components.Card.schema.properties.title.anyOf).toHaveLength(2);
    expect(entry.value).not.toContain('"$ref"');
  });

  it("still emits an entry for a catalog without components", () => {
    const entry = catalogToContextEntry({ id: CATALOG_ID, components: [] });

    expect(JSON.parse(entry.value)).toEqual({
      catalogId: CATALOG_ID,
      components: {},
    });
  });
});
