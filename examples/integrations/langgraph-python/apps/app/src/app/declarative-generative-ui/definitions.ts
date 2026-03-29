/**
 * Demonstration Catalog — Component Definitions
 *
 * Platform-agnostic definitions: component names, props (Zod), descriptions.
 * This is the contract between the app and the AI agent. Agents receive these
 * definitions as context so they know what components are available.
 *
 * Renderers (React, React Native, etc.) import these definitions and provide
 * platform-specific implementations, type-checked against the Zod schemas.
 */

import { z } from "zod";

export const demonstrationCatalogDefinitions = {
  Title: {
    description: "A heading. Use for section titles and page headers.",
    props: z.object({
      text: z.string(),
      level: z.string().optional(),
    }),
  },

  Text: {
    description: "Plain text content. Use for descriptions, labels, body copy.",
    props: z.object({
      text: z.string(),
      variant: z.string().optional(),
    }),
  },

  Row: {
    description: "Horizontal layout container. Children are laid out in a row. Use 'children' array with component IDs.",
    props: z.object({
      gap: z.number().optional(),
      align: z.string().optional(),
      justify: z.string().optional(),
      children: z.array(z.string()),
    }),
  },

  Column: {
    description: "Vertical layout container. Children are laid out in a column. Use 'children' array with component IDs.",
    props: z.object({
      gap: z.number().optional(),
      children: z.array(z.string()),
    }),
  },

  DashboardCard: {
    description: "A card container with title and optional subtitle. Has a 'child' slot for content (chart, metrics, etc). Use 'child' with a single component ID.",
    props: z.object({
      title: z.string(),
      subtitle: z.string().optional(),
      child: z.string().optional(),
    }),
  },

  Metric: {
    description: "A key metric display with label, value, and optional trend indicator. Great for KPIs and stats.",
    props: z.object({
      label: z.string(),
      value: z.string(),
      trend: z.enum(["up", "down", "neutral"]).optional(),
      trendValue: z.string().optional(),
    }),
  },

  PieChart: {
    description: "A pie/donut chart. Provide data as array of {label, value, color} objects.",
    props: z.object({
      data: z.array(z.object({ label: z.string(), value: z.number(), color: z.string().optional() })),
      innerRadius: z.number().optional(),
    }),
  },

  BarChart: {
    description: "A bar chart. Provide data as array of {label, value} objects.",
    props: z.object({
      data: z.array(z.object({ label: z.string(), value: z.number() })),
      color: z.string().optional(),
    }),
  },

  Badge: {
    description: "A small status badge/tag. Use for labels, statuses, categories.",
    props: z.object({
      text: z.string(),
      variant: z.enum(["success", "warning", "error", "info", "neutral"]).optional(),
    }),
  },

  DataTable: {
    description: "A data table with columns and rows.",
    props: z.object({
      columns: z.array(z.object({ key: z.string(), label: z.string() })),
      rows: z.array(z.record(z.any())),
    }),
  },

  Button: {
    description: "An interactive button with an action event.",
    props: z.object({
      label: z.string(),
      variant: z.enum(["primary", "secondary", "ghost"]).optional(),
      action: z.any().optional(),
    }),
  },
};

/** Type helper for renderers */
export type DemonstrationCatalogDefinitions = typeof demonstrationCatalogDefinitions;
