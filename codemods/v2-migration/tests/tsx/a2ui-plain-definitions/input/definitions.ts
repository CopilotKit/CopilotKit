import { z } from "zod";

/** A literal string or a data-model path binding. */
const DynString = z
  .union([z.string(), z.object({ path: z.string() })])
  .describe("REF:common_types.json#/$defs/DynamicString");

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
      action: z
        .union([
          z.object({ event: z.object({ name: z.string() }) }),
          z.null(),
        ])
        .optional(),
    }),
  },
};

export type DemoDefinitions = typeof demoDefinitions;
