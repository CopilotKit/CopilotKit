"use client";
import { z } from "zod";
import {
  createCatalog,
  DynamicStringSchema,
  DynamicNumberSchema,
  DynamicBooleanSchema,
  ChildListSchema,
  ActionSchema,
} from "@copilotkit/a2ui-renderer";
import type { CatalogRenderers, DynamicString } from "@copilotkit/a2ui-renderer";
import { sharedDefinitions } from "./definitions";
import { sharedRenderers } from "./renderers";

const definitions = {
  Airport: {
    description: "An airport by IATA code, with its city under it.",
    props: z.object({ code: DynamicStringSchema, city: DynamicStringSchema }),
  },
  Price: {
    props: z.object({
      amount: DynamicNumberSchema,
      label: z.union([z.string(), z.object({ path: z.string() })]),
      onSale: DynamicBooleanSchema.optional(),
    }),
  },
  Arrow: { props: z.object({}) },
};

const renderers: CatalogRenderers<typeof definitions> = {
  Airport: ({ props }) => (
    <div>
      <strong>{props.code}</strong>
      <span>{props.city}</span>
    </div>
  ),
  Price: ({ props, dispatch }) => (
    <button onClick={() => dispatch?.({ name: "buy" })}>{props.amount}</button>
  ),
  // Drawn between two airports.
  Arrow: () => <span aria-hidden="true">→</span>,
};

export const myCatalog = createCatalog(definitions, renderers, {
  catalogId: "acme/flights",
  includeBasicCatalog: true,
});

export const label: DynamicString = "Flights";

export const inlineCatalog = createCatalog(
  {
    Badge: {
      description: "A small label.",
      props: z.object({ text: z.string().or(z.object({ path: z.string() })) }),
    },
  },
  {
    Badge: ({ props }) => <em>{props.text}</em>,
  },
);

const cardDefinitions = {
  Card: {
    description: "A card with a title and children.",
    props: z.object({
      title: DynamicStringSchema,
      children: ChildListSchema,
      action: ActionSchema.optional(),
    }),
  },
};
export const cardCatalog = createCatalog(cardDefinitions, sharedRenderers);

export const sharedCatalog = createCatalog(sharedDefinitions, {
  Title: ({ props }) => <h1>{props.text}</h1>,
});

export const unknownCatalog = createCatalog(sharedDefinitions, sharedRenderers);
