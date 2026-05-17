/**
 * A2UI catalog — *platform-agnostic* component definitions.
 *
 * Each entry pairs a Zod schema (the props the agent will fill in) with
 * a description (what the LLM sees when choosing components). NO
 * rendering details live here — both this Slack bot's renderers and a
 * sibling web app's React renderers can target the same definitions.
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
 * data-model path binding like `{ path: "flights[*].airline" }`. The
 * bridge resolves bindings against the surface's data model before
 * the renderer runs, so renderers always see a resolved string.
 */
const DynString = z.union([z.string(), z.object({ path: z.string() })]);

export const dashboardDefinitions = {
  Title: {
    description: "A heading. Use for section titles and page headers.",
    props: z.object({
      text: DynString,
      level: z.enum(["h1", "h2", "h3"]).optional(),
    }),
  },

  Metric: {
    description:
      "A key metric — label + value + optional trend. Great for KPIs and stats.",
    props: z.object({
      label: z.string(),
      value: DynString,
      trend: z.enum(["up", "down", "neutral"]).optional(),
      trendValue: z.string().optional(),
    }),
  },

  Badge: {
    description:
      "A small colored status badge. Use for labels, statuses, categories.",
    props: z.object({
      text: DynString,
      variant: z
        .enum(["success", "warning", "error", "info", "neutral"])
        .optional(),
    }),
  },

  FlightCard: {
    description:
      "A rich flight result card. Displays airline, flight number, route, " +
      "times, duration, status, and price. Use one per flight option.",
    props: z.object({
      id: DynString,
      airline: DynString,
      airlineLogo: DynString,
      flightNumber: DynString,
      origin: DynString,
      destination: DynString,
      date: DynString,
      departureTime: DynString,
      arrivalTime: DynString,
      duration: DynString,
      status: DynString,
      price: DynString,
      // Optional action — when present, the card renders a "Select"
      // button that dispatches `{ event: { name, context } }` back to
      // the agent on click.
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

export type DashboardDefinitions = typeof dashboardDefinitions;
