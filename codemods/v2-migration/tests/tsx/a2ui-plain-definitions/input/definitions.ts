import { z } from "zod";

/** A literal string or a data-model path binding. */
const DynString = z
  .union([z.string(), z.object({ path: z.string() })])
  .describe("REF:common_types.json#/$defs/DynamicString");

/** The v0.9 action of the interactive components. */
const ActionSchema = z
  .union([z.object({ event: z.object({ name: z.string() }) }), z.null()])
  .optional();

/** Child ids, or a template, shared by the containers. */
const childrenRef = z.union([
  z.array(z.string()),
  z.object({ componentId: z.string(), path: z.string() }),
]);
const childRef = z.string();

export const demoDefinitions = {
  Row: {
    description: "Horizontal layout container.",
    props: z.object({
      gap: z.number().optional(),
      // Union with { componentId, path } for template children.
      children: z.union([
        z.array(z.string()),
        z.object({ componentId: z.string(), path: z.string() }),
      ]),
    }),
  },
  Column: {
    description: "Vertical layout container.",
    props: z.object({ children: childrenRef }),
  },
  Panel: {
    description: "A panel with an optional body.",
    props: z.object({ child: childRef.optional() }),
  },
  Card: {
    description: "A card with one child.",
    props: z.object({
      child: z
        .string()
        .describe("REF:common_types.json#/$defs/ComponentId|The card body."),
      footer: z.string().describe("REF:common_types.json#/$defs/ComponentId"),
    }),
  },
  DataTable: {
    description: "A data table.",
    props: z.object({
      rows: z.array(z.record(z.any())),
    }),
  },
  FlightCard: {
    description: "A flight result card.",
    props: z.object({
      airline: DynString,
      price: DynString.optional(),
      note: z
        .string()
        .describe("REF:common_types.json#/$defs/DynamicString|A short note."),
      action: ActionSchema,
    }),
  },
};

export type DemoDefinitions = typeof demoDefinitions;
