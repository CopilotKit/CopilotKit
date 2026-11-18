/**
 * Demonstration Catalog — Component Definitions
 *
 * Platform-agnostic definitions: component names, descriptions, props (Zod),
 * slots and events. This is the contract between the app and the AI agent:
 * the runtime sends these to the agent with the `render_ui` tool, so it knows
 * which components it can render.
 *
 * The renderers (renderers.tsx) add a React component to each definition.
 * The layout components (Row, Column, Title, Text, Button, Badge, ...) come
 * from the standard catalog, which the demo catalog extends.
 */

import { z } from "zod";

export const demonstrationCatalogDefinitions = {
  DashboardCard: {
    description:
      "A card with a title and an optional subtitle. Put one component (a chart, a Metric, a Row of Metrics, ...) in its 'child' slot.",
    props: z.object({
      title: z.string(),
      subtitle: z.string().optional(),
    }),
    slots: { child: "single" },
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

  DataTable: {
    description: "A data table with columns and rows.",
    props: z.object({
      columns: z.array(z.object({ key: z.string(), label: z.string() })),
      rows: z.array(z.record(z.string(), z.unknown())),
    }),
  },

  FlightCard: {
    description:
      "A rich flight result card. Displays airline, flight number, route, times, duration, status, and price. Put several in a Row for side-by-side layout. Bind onSelect to an event named book_flight, with the flight in its context.",
    props: z.object({
      airline: z.string(),
      airlineLogo: z.string(),
      flightNumber: z.string(),
      origin: z.string(),
      destination: z.string(),
      date: z.string(),
      departureTime: z.string(),
      arrivalTime: z.string(),
      duration: z.string(),
      status: z.string(),
      statusColor: z.string().optional(),
      price: z.string(),
    }),
    events: {
      onSelect: {
        description: "Sent when the user selects the flight.",
        parameters: z.object({}),
      },
    },
  },
} as const;
