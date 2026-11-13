/**
 * Demonstration Catalog -- Component Definitions
 *
 * Platform-agnostic definitions: component names, props (Zod), descriptions.
 * This is the contract between the app and the AI agent. Agents receive these
 * definitions as context so they know what components are available.
 *
 * Renderers (React, React Native, etc.) import these definitions and provide
 * platform-specific implementations, type-checked against the Zod schemas.
 */

import { z } from "zod";
import { childList, child } from "@copilotkit/react-core/generative-ui";

/**
 * A string the agent may bind to a data-model path like `{ path: "airline" }`.
 * Generative UI resolves the binding before render, so the component only
 * sees the resolved string.
 */
const DynString = z.string();

export const demonstrationCatalogDefinitions = {
  Title: {
    description: "A heading. Use for section titles and page headers.",
    props: z.object({
      text: z.string(),
      level: z.string().optional(),
    }),
  },

  // Text: not declared. This catalog does not extend the standard catalog.

  Row: {
    description: "Horizontal layout container.",
    props: z.object({
      gap: z.number().optional(),
      align: z.string().optional(),
      justify: z.string().optional(),
      // A list of component ids, or a template `{ componentId, path }` that
      // repeats a component for each item of a data-model list.
      children: childList(),
    }),
  },

  Column: {
    description: "Vertical layout container.",
    props: z.object({
      gap: z.number().optional(),
      align: z.string().optional(),
      children: childList(),
    }),
  },

  DashboardCard: {
    description:
      "A card container with title and optional subtitle. Has a 'child' slot for content (chart, metrics, etc). Use 'child' with a single component ID.",
    props: z.object({
      title: z.string(),
      subtitle: z.string().optional(),
      child: child().optional(),
    }),
  },

  Metric: {
    description:
      "A key metric display with label, value, and optional trend indicator. Great for KPIs and stats.",
    props: z.object({
      label: z.string(),
      value: z.string(),
      trend: z.enum(["up", "down", "neutral"]).optional(),
      trendValue: z.string().optional(),
    }),
  },

  PieChart: {
    description:
      "A pie/donut chart. Provide data as array of {label, value, color} objects.",
    props: z.object({
      data: z.array(
        z.object({
          label: z.string(),
          value: z.number(),
          color: z.string().optional(),
        }),
      ),
      innerRadius: z.number().optional(),
    }),
  },

  BarChart: {
    description:
      "A bar chart. Provide data as array of {label, value} objects.",
    props: z.object({
      data: z.array(z.object({ label: z.string(), value: z.number() })),
      color: z.string().optional(),
    }),
  },

  Badge: {
    description:
      "A small status badge/tag. Use for labels, statuses, categories.",
    props: z.object({
      text: z.string(),
      variant: z
        .enum(["success", "warning", "error", "info", "neutral"])
        .optional(),
    }),
  },

  DataTable: {
    description: "A data table with columns and rows.",
    props: z.object({
      columns: z.array(z.object({ key: z.string(), label: z.string() })),
      rows: z.array(z.record(z.string(), z.any())),
    }),
  },

  Button: {
    description:
      "An interactive button with an action event. Use 'child' with a Text component ID for the label. 'action' is sent to the agent on click.",
    props: z.object({
      child: child(
        "The ID of the child component (e.g. a Text component for the label).",
      ),
      variant: z.enum(["primary", "secondary", "ghost"]).optional(),
    }),
    events: { onClick: { parameters: z.object({}) } },
  },

  FlightCard: {
    description:
      "A rich flight result card. Displays airline, flight number, route, times, duration, status, and price. Use inside a Row for side-by-side layout.",
    props: z.object({
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
      statusColor: DynString.optional(),
      price: DynString,
    }),
    events: { action: { parameters: z.object({}) } },
  },
};

/** Type helper for renderers */
export type DemonstrationCatalogDefinitions =
  typeof demonstrationCatalogDefinitions;
