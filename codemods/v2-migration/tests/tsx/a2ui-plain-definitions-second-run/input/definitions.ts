import { z } from "zod";
import { childList, child } from "@copilotkit/react-core/generative-ui";

/** A literal string or a data-model path binding. */
const DynString = z.string();

/** Child ids, or a template, shared by the containers. */
const childrenRef = childList();
const childRef = child();

export const demoDefinitions = {
  Row: {
    description: "Horizontal layout container.",
    props: z.object({
      gap: z.number().optional(),
      // Union with { componentId, path } for template children.
      children: childList(),
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
      child: child("The card body."),
      footer: child(),
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
