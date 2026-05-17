/**
 * A2UI catalog — *platform-agnostic* component definitions.
 *
 * This catalog matches the python showcase's `a2ui_fixed` agent
 * (see `packages/slack/agent/src/agents/a2ui_schemas/flight_schema.json`).
 * The agent loads that JSON at startup and emits surfaces tagged with
 * `catalog_id: "copilotkit://flight-fixed-catalog"`. The bridge picks
 * THIS catalog by matching that id (see `./index.ts`).
 *
 * To keep the agent's schema-context blob small, only define
 * components the agent should actually use. Add fields as `DynString`
 * (literal string OR `{ path: "data.field" }`) when you want the agent
 * to fill values from a data model rather than inline them — the
 * bridge resolves bindings at render time.
 */
import { z } from "zod";
import type { CatalogDefinitions } from "../../src/index.js";

/**
 * A "dynamic string": the agent may pass either an inline string or a
 * data-model path binding like `{ path: "/airline" }`. The bridge
 * resolves bindings against the surface's data model before the
 * renderer runs.
 */
const DynString = z.union([z.string(), z.object({ path: z.string() })]);

export const flightDefinitions = {
  Card: {
    description: "Container with one child slot.",
    props: z.object({
      child: z.string().optional(),
    }),
  },

  Column: {
    description: "Vertical stack of children.",
    props: z.object({
      children: z.union([
        z.array(z.string()),
        z.object({ componentId: z.string(), path: z.string() }),
      ]),
      gap: z.number().optional(),
    }),
  },

  Row: {
    description: "Horizontal arrangement of children.",
    props: z.object({
      children: z.union([
        z.array(z.string()),
        z.object({ componentId: z.string(), path: z.string() }),
      ]),
      gap: z.number().optional(),
      align: z.string().optional(),
      justify: z.string().optional(),
    }),
  },

  Title: {
    description: "Section header text.",
    props: z.object({ text: DynString }),
  },

  Text: {
    description: "Body text.",
    props: z.object({ text: DynString }),
  },

  Airport: {
    description: "Three-letter airport code, bolded.",
    props: z.object({ code: DynString }),
  },

  Arrow: {
    description: "Right-pointing arrow separator.",
    props: z.object({}),
  },

  AirlineBadge: {
    description: "Small airline name pill.",
    props: z.object({ name: DynString }),
  },

  PriceTag: {
    description: "Price displayed prominently.",
    props: z.object({ amount: DynString }),
  },

  Button: {
    description:
      "Action button. Renders a single child component (typically a Text) " +
      "as the label, and fires `action.event` when clicked.",
    props: z.object({
      child: z.string().optional(),
      variant: z.enum(["primary", "secondary", "ghost"]).optional(),
      action: z
        .object({
          event: z.object({
            name: z.string(),
            context: z.record(z.any()).optional(),
          }),
        })
        .optional(),
    }),
  },
} satisfies CatalogDefinitions;

export type FlightDefinitions = typeof flightDefinitions;
