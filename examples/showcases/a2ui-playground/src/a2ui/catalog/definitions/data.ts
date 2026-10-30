import { z } from "zod";
import { def, tone } from "./shared";

/** Badge and List come from the Gen UI 2.0 standard catalog. */

export const statValue = z.union([z.string(), z.number()]);
const kv = z.object({
  label: z.string(),
  value: z.union([z.string(), z.number()]),
  hint: z.string().optional(),
});

export const dataDefinitions = {
  Stat: def(
    "Data display",
    "One numeric KPI: label, short value (number or <10 chars like '$84k'), optional delta (e.g. '+4.2%'), caption. Not for sentences.",
    z.object({
      label: z.string(),
      value: statValue,
      delta: z.string().optional(),
      trend: z.enum(["up", "down", "flat"]).optional(),
      caption: z.string().optional(),
      tone: tone.optional(),
      icon: z.string().optional(),
    }),
  ),
  StatGroup: def(
    "Data display",
    "Compact strip of several KPIs in one card.",
    z.object({
      items: z.array(
        z.object({
          label: z.string(),
          value: z.union([z.string(), z.number()]),
          delta: z.string().optional(),
          trend: z.enum(["up", "down", "flat"]).optional(),
        }),
      ),
    }),
  ),
  Avatar: def(
    "Data display",
    "Person avatar (initials if no image) with name and subtitle: authors, owners, reviewers.",
    z.object({
      name: z.string(),
      image: z.string().optional(),
      subtitle: z.string().optional(),
      size: z.enum(["sm", "md", "lg"]).optional(),
      status: z.enum(["online", "away", "offline"]).optional(),
    }),
  ),
  AvatarGroup: def(
    "Data display",
    "Overlapping avatar stack with +N overflow: attendees, team members, reviewers.",
    z.object({
      people: z.array(
        z.object({ name: z.string(), image: z.string().optional() }),
      ),
      max: z.number().optional(),
      label: z.string().optional(),
    }),
  ),
  DataTable: def(
    "Data display",
    "Sortable, filterable table (TanStack Table). columns [{key,label,format?}], rows are objects keyed by column key.",
    z.object({
      title: z.string().optional(),
      columns: z.array(
        z.object({
          key: z.string(),
          label: z.string(),
          format: z
            .enum(["text", "number", "currency", "percent", "badge", "date"])
            .optional(),
          align: z.enum(["left", "right"]).optional(),
        }),
      ),
      rows: z.array(z.record(z.any())),
      searchable: z.boolean().optional(),
      pageSize: z.number().optional(),
    }),
  ),
  KeyValueList: def(
    "Data display",
    "Label/value rows, e.g. specs or order details.",
    z.object({
      title: z.string().optional(),
      items: z.array(kv),
      columns: z.number().optional(),
    }),
  ),
  Timeline: def(
    "Data display",
    "Vertical timeline of dated events or steps with status.",
    z.object({
      items: z.array(
        z.object({
          title: z.string(),
          time: z.string().optional(),
          description: z.string().optional(),
          status: z.enum(["done", "current", "upcoming"]).optional(),
          icon: z.string().optional(),
        }),
      ),
    }),
  ),
  Progress: def(
    "Data display",
    "Labelled progress bar, value 0-100: goals, budgets used, completion, coverage.",
    z.object({
      label: z.string().optional(),
      value: z.number(),
      caption: z.string().optional(),
      tone: tone.optional(),
    }),
  ),
  RadialProgress: def(
    "Data display",
    "Ring with centered value, value 0-100: a single score or percent complete.",
    z.object({
      label: z.string().optional(),
      value: z.number(),
      display: z.string().optional(),
      tone: tone.optional(),
    }),
  ),
  Rating: def(
    "Data display",
    "Star rating (0-5) with optional review count: products, places, reviews.",
    z.object({
      value: z.number(),
      count: z.number().optional(),
      label: z.string().optional(),
    }),
  ),
  TagList: def(
    "Data display",
    "Wrapping list of tags/chips.",
    z.object({ tags: z.array(z.string()), tone: tone.optional() }),
  ),
  Agenda: def(
    "Data display",
    "Calendar agenda: days with timed events (conference, week plan, schedule). Prefer over Timeline for clock times.",
    z.object({
      title: z.string().optional(),
      days: z.array(
        z.object({
          date: z.string(),
          label: z.string().optional(),
          events: z.array(
            z.object({
              time: z.string().optional(),
              title: z.string(),
              speaker: z.string().optional(),
              location: z.string().optional(),
              description: z.string().optional(),
              tone: tone.optional(),
            }),
          ),
        }),
      ),
    }),
  ),
  ComparisonTable: def(
    "Data display",
    "Feature matrix comparing options side by side; values may be true/false/text; highlight marks the recommended option.",
    z.object({
      title: z.string().optional(),
      options: z.array(z.string()),
      rows: z.array(
        z.object({
          feature: z.string(),
          values: z.array(z.union([z.string(), z.number(), z.boolean()])),
        }),
      ),
      highlight: z.number().optional(),
    }),
  ),
};
