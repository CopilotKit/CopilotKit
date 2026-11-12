import { z } from "zod";
import { childList } from "@copilotkit/react-core/generative-ui";

/** A literal string or a data-model path binding. */
const DynString = z.string();

export const demoDefinitions = {
  Row: {
    description: "Horizontal layout container.",
    props: z.object({
      gap: z.number().optional(),
      // Union with { componentId, path } for template children.
      children: childList(),
    }),
  },
  DataTable: {
    description: "A data table.",
    props: z.object({
      rows: z.array(z.record(z.string(), z.any())),
    }),
  },
  FlightCard: {
    description: "A flight result card.",
    props: z.object({
      airline: DynString,
      price: DynString.optional(),
      note: z
        .string()
        .describe("A short note."),
    }),
    events: { action: { parameters: z.object({}) } },
  },
};

export type DemoDefinitions = typeof demoDefinitions;
